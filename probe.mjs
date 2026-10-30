// First-contact check for live keys: prints the raw shapes the grader depends on. Prints no key.
// Run: npm run probe
import { get, QLOO_MODE } from './lib/qloo.mjs';
import { chat, LLM_MODE, TARGET_MODEL, AUDITOR_MODEL } from './lib/llm.mjs';

console.log({ qloo: QLOO_MODE, llm: LLM_MODE });
const log = c => console.log('  ', c.status, c.path, `${c.ms}ms`);
const rows = b => Array.isArray(b?.results) ? b.results : b?.results?.entities ?? [];
const brief = e => ({ name: e.name, id: e.entity_id, sub: e.subtype || e.types, pop: e.popularity, aff: e.query?.affinity,
  addr: e.properties?.address, geo: e.properties?.geocode, loc: e.location, disamb: e.disambiguation });
const show = async (label, path, q) => {
  try {
    const b = await get(path, q, log);
    const r = rows(b);
    console.log(`\n# ${label}: top-level keys ${Object.keys(b)} · results ${Array.isArray(b?.results) ? 'array' : Object.keys(b?.results || {})} · n=${r.length}`);
    if (r[0]) console.log('first raw (trimmed):', JSON.stringify(r[0]).slice(0, 1500));
    for (const e of r.slice(0, 6)) console.log(JSON.stringify(brief(e)));
    return r;
  } catch (err) { console.log(`\n# ${label}: ERROR ${err.message}`); return []; }
};

if (QLOO_MODE === 'live') {
  await show('search place "Terra Kulture Lagos"', '/search', { query: 'Terra Kulture Lagos', types: 'urn:entity:place', take: 5 });
  await show('search place "Franklin Barbecue" (no city)', '/search', { query: 'Franklin Barbecue', types: 'urn:entity:place', take: 5 });
  await show('search place "Nobu Lagos" (chain, wrong city?)', '/search', { query: 'Nobu Lagos', types: 'urn:entity:place', take: 5 });
  await show('search place "Totally Made Up Bistro Lagos"', '/search', { query: 'Totally Made Up Bistro Lagos', types: 'urn:entity:place', take: 5 });
  const fela = (await show('search artist "Fela Kuti"', '/search', { query: 'Fela Kuti', types: 'urn:entity:artist', take: 3 }))[0]?.entity_id;
  await show('search artist "Taylor Swift" (popularity scale)', '/search', { query: 'Taylor Swift', types: 'urn:entity:artist', take: 1 });
  const lagosPlaces = { 'filter.type': 'urn:entity:place', 'filter.location.query': 'Lagos', take: 8 };
  await show('places, filter.location.query=Lagos only', '/v2/insights', lagosPlaces);
  await show('places in Lagos for Fela fans 55+', '/v2/insights', { ...lagosPlaces,
    'signal.interests.entities': fela, 'signal.location.query': 'Lagos', 'signal.demographics.age': '55_and_older' });
  await show('artists for Lagos 55+, popularity.max 0.9', '/v2/insights', { 'filter.type': 'urn:entity:artist',
    'signal.location.query': 'Lagos', 'signal.demographics.age': '55_and_older', 'filter.popularity.max': 0.9, take: 6 });
  await show('artists, no signal (should 400 or need signal?)', '/v2/insights', { 'filter.type': 'urn:entity:artist', take: 3 });
}

if (LLM_MODE === 'live') {
  for (const model of [TARGET_MODEL, AUDITOR_MODEL]) {
    try {
      const r = await chat({ model, json: true, messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }] });
      console.log(`\n# ${model}:`, r.content.slice(0, 80));
    } catch (err) { console.log(`\n# ${model}: ERROR ${err.message}`); }
  }
}
