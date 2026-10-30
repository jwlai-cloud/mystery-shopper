// The Mystery Shopper agent: probe a target assistant with Qloo-built segment probes,
// grade every recommendation against Qloo, dig into the worst segment, repair the target, re-test.

import { makeQloo } from './qloo.mjs';
import { chat, parseJson, TARGET_MODEL, AUDITOR_MODEL } from './llm.mjs';

export const BASE_PROMPT = 'You are the AI travel concierge for a booking app. Give friendly, concrete recommendations for where to eat, go out and what music to check out.';

// Segments are aggregate audiences (city x age band x taste seeds), never individuals.
export const SEGMENTS = [
  { id: 'lagos-55', city: 'Lagos', age: '55_and_older', ageText: 'in my sixties', seeds: ['Fela Kuti', 'King Sunny Adé'] },
  { id: 'austin-25', city: 'Austin', age: '25_to_29', ageText: 'in my mid twenties', seeds: ['Willie Nelson', 'Gary Clark Jr.'] },
  { id: 'osaka-35', city: 'Osaka', age: '35_to_44', ageText: 'about forty', seeds: ['Tatsuro Yamashita', 'Mariya Takeuchi'] },
];

const MAINSTREAM = 0.95; // popularity percentile at or above which a pick counts as global-mainstream
const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(the|restaurant|cafe|bar)\b/g, '').replace(/[^a-z0-9]/g, '');

export async function runAudit({ segments = SEGMENTS, turns = 2, adaptive = true, emit = () => {} }) {
  const qloo = makeQloo(call => emit('qloo', call));
  const seedIds = new Map();

  async function resolveSeeds(seg) {
    const ids = [];
    for (const name of seg.seeds) {
      if (!seedIds.has(name)) seedIds.set(name, (await qloo.search(name, 'urn:entity:artist'))[0]?.id);
      if (seedIds.get(name)) ids.push(seedIds.get(name));
    }
    return ids;
  }

  // Stage 2 gives the target this tool. It returns Qloo's own affinity ranking for the segment, no popularity filter.
  const qlooTool = {
    type: 'function',
    function: {
      name: 'qloo_local_taste',
      description: 'Look up what people with a given taste, age band and city actually like, from Qloo. Use before recommending.',
      parameters: { type: 'object', properties: { city: { type: 'string' }, kind: { type: 'string', enum: ['place', 'artist'] } }, required: ['city', 'kind'] },
    },
  };

  async function converse(seg, systemPrompt, withTool) {
    const messages = [{ role: 'system', content: systemPrompt }];
    const asks = [
      `I'm in ${seg.city} for a week. I'm ${seg.ageText} and into ${seg.seeds.join(' and ')}. Give me 3 places to eat or hang out and 2 artists or live music spots I should check out.`,
      `Those sound like the tourist list. Where do people around my age in ${seg.city} actually go?`,
    ].slice(0, turns);
    const replies = [];
    for (const ask of asks) {
      messages.push({ role: 'user', content: ask });
      emit('ask', { seg: seg.id, text: ask });
      for (let hop = 0; hop < 4; hop++) {
        const r = await chat({ model: TARGET_MODEL, messages, tools: withTool ? [qlooTool] : undefined, task: 'target' });
        if (!r.tool_calls.length) { messages.push({ role: 'assistant', content: r.content }); replies.push(r.content); emit('reply', { seg: seg.id, text: r.content }); break; }
        messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.tool_calls });
        for (const tc of r.tool_calls) {
          const args = parseJson(tc.function.arguments);
          const kind = args.kind === 'artist' ? 'artist' : 'place';
          const found = await qloo.insights({
            'filter.type': `urn:entity:${kind}`,
            ...(kind === 'place' ? { 'filter.location.query': seg.city } : {}),
            'signal.location.query': seg.city,
            'signal.interests.entities': await resolveSeeds(seg),
            'signal.demographics.age': seg.age,
            take: 8,
          });
          emit('tool', { seg: seg.id, kind, names: found.map(e => e.name) });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(found.map(e => ({ name: e.name, address: e.address }))) });
        }
      }
    }
    return replies;
  }

  async function extract(seg, replies) {
    const r = await chat({
      model: AUDITOR_MODEL, json: true, task: 'extract',
      messages: [
        { role: 'system', content: 'Extract every concrete recommendation (named place, venue, restaurant, artist, band) from the assistant replies. Return JSON {"recs":[{"name":"...","kind":"place|artist","city":"..."}]}. Use the exact names given. No commentary.' },
        { role: 'user', content: `Traveller city: ${seg.city}\n\n${replies.join('\n\n')}` },
      ],
    });
    const seen = new Set();
    return (parseJson(r.content).recs || []).filter(x => x.name && !seen.has(norm(x.name)) && seen.add(norm(x.name)));
  }

  // Grade one recommendation against Qloo. Objective checks first; affinity is filled in per batch below.
  async function grade(seg, rec) {
    const kind = rec.kind === 'artist' ? 'artist' : 'place';
    const cands = await qloo.search(kind === 'place' ? `${rec.name} ${seg.city}` : rec.name, `urn:entity:${kind}`)
      .then(c => c.length ? c : qloo.search(rec.name, `urn:entity:${kind}`));
    const named = cands.filter(c => norm(c.name) === norm(rec.name) || (norm(rec.name).length > 4 && (norm(c.name).includes(norm(rec.name)) || norm(rec.name).includes(norm(c.name)))));
    const inCity = c => JSON.stringify([c.address, c.geocode]).toLowerCase().includes(seg.city.toLowerCase());
    const match = named.find(inCity) || named[0];
    const g = { name: rec.name, kind, said: rec.name };
    if (!match) return { ...g, verdict: 'phantom', why: 'No Qloo entity with this name' };
    Object.assign(g, { id: match.id, qlooName: match.name, popularity: match.popularity, address: match.address });
    if (kind === 'place' && !inCity(match)) return { ...g, verdict: 'elsewhere', why: `Qloo places it outside ${seg.city}${match.address ? `: ${match.address}` : ''}` };
    if (match.popularity >= MAINSTREAM) return { ...g, verdict: 'mainstream', why: `Popularity percentile ${(match.popularity * 100).toFixed(1)}` };
    return { ...g, verdict: 'ok', why: 'Exists, local, not global top 5%' };
  }

  async function affinity(seg, graded) {
    for (const kind of ['place', 'artist']) {
      const ids = graded.filter(g => g.kind === kind && g.id).map(g => g.id);
      if (!ids.length) continue;
      const ranked = await qloo.insights({
        'filter.type': `urn:entity:${kind}`, 'filter.results.entities': ids,
        'signal.interests.entities': await resolveSeeds(seg), 'signal.location.query': seg.city,
        'signal.demographics.age': seg.age, take: ids.length,
      });
      for (const e of ranked) { const g = graded.find(x => x.id === e.id); if (g) g.affinity = e.affinity; }
    }
  }

  async function probe(stage, seg, systemPrompt, withTool) {
    emit('probe', { stage, seg });
    const replies = await converse(seg, systemPrompt, withTool);
    const recs = await extract(seg, replies);
    const graded = await Promise.all(recs.map(r => grade(seg, r)));
    await affinity(seg, graded);
    for (const g of graded) emit('rec', { stage, seg: seg.id, ...g });
    return { seg, graded };
  }

  async function stage(name, systemPrompt, withTool, segs) {
    emit('stage', { name, withTool, systemPrompt });
    const results = await Promise.all(segs.map(s => probe(name, s, systemPrompt, withTool)));
    const m = metrics(results.flatMap(r => r.graded));
    emit('metrics', { stage: name, ...m, bySeg: Object.fromEntries(results.map(r => [r.seg.id, metrics(r.graded)])) });
    return { results, m };
  }

  emit('start', { segments, turns, target: TARGET_MODEL, auditor: AUDITOR_MODEL, qloo: qloo.mode });
  let segs = [...segments];
  const base = await stage('baseline', BASE_PROMPT, false, segs);

  // Agentic step: find the worst segment and probe it harder with seeds Qloo says that audience likes but that aren't mainstream.
  if (adaptive) {
    const worst = base.results.map(r => ({ seg: r.seg, m: metrics(r.graded) })).sort((a, b) => b.m.failRate - a.m.failRate)[0];
    const fresh = await qloo.insights({
      'filter.type': 'urn:entity:artist', 'signal.location.query': worst.seg.city, 'signal.demographics.age': worst.seg.age,
      'filter.popularity.max': 0.9, take: 6,
    });
    const newSeeds = fresh.map(e => e.name).filter(n => !worst.seg.seeds.includes(n)).slice(0, 2);
    if (newSeeds.length) {
      const extra = { ...worst.seg, id: `${worst.seg.id}-deep`, seeds: newSeeds, adaptive: true };
      emit('adapt', { from: worst.seg.id, failRate: worst.m.failRate, newSeeds, why: `${worst.seg.city} ${worst.seg.ageText} had the highest failure rate (${pct(worst.m.failRate)}). Probing again with seeds Qloo ranks for that audience below the mainstream cut.` });
      const more = await probe('baseline', extra, BASE_PROMPT, false);
      base.results.push(more);
      segs.push(extra);
      base.m = metrics(base.results.flatMap(r => r.graded));
      emit('metrics', { stage: 'baseline', ...base.m, bySeg: Object.fromEntries(base.results.map(r => [r.seg.id, metrics(r.graded)])) });
    }
  }

  // Repair stage 1: prompt only, no Qloo. The lift here cannot come from grading with the fix.
  const failures = base.results.flatMap(r => r.graded.filter(g => g.verdict !== 'ok').map(g => `[${r.seg.city}, ${r.seg.ageText}] ${g.name}: ${g.verdict} (${g.why})`));
  const p = parseJson((await chat({
    model: AUDITOR_MODEL, json: true, task: 'patch',
    messages: [
      { role: 'system', content: BASE_PROMPT },
      { role: 'user', content: `You are auditing the system prompt above. These recommendations failed a check against Qloo's taste graph:\n${failures.join('\n')}\n\nWrite a revised system prompt that fixes the failure patterns without naming any specific places or artists. Return JSON {"diagnosis":"one sentence","system_prompt":"..."}.` },
    ],
  })).content);
  const patched = p.system_prompt || BASE_PROMPT;
  emit('patch', { diagnosis: p.diagnosis, system_prompt: patched });
  const s1 = await stage('prompt-fix', patched, false, segs);

  // Repair stage 2: same prompt, plus a Qloo tool (route (c): wire Qloo into an existing agent).
  const s2 = await stage('qloo-tool', patched, true, segs);

  const summary = { baseline: base.m, 'prompt-fix': s1.m, 'qloo-tool': s2.m };
  emit('done', summary);
  return summary;
}

export function metrics(graded) {
  const n = graded.length;
  const count = v => graded.filter(g => g.verdict === v).length;
  const resolved = graded.filter(g => g.verdict !== 'phantom');
  const aff = graded.filter(g => typeof g.affinity === 'number');
  return {
    n,
    phantom: count('phantom') / (n || 1),
    elsewhere: count('elsewhere') / (resolved.filter(g => g.kind === 'place').length || 1),
    mainstream: count('mainstream') / (resolved.length || 1),
    failRate: (n - count('ok')) / (n || 1),
    affinity: aff.length ? aff.reduce((s, g) => s + g.affinity, 0) / aff.length : null,
  };
}

const pct = x => `${Math.round(x * 100)}%`;
