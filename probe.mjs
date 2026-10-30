// First-contact check for live keys: prints shapes the grader depends on. Prints no key.
// Run: npm run probe
import { makeQloo, QLOO_MODE } from './lib/qloo.mjs';
import { chat, LLM_MODE, TARGET_MODEL, AUDITOR_MODEL } from './lib/llm.mjs';

console.log({ qloo: QLOO_MODE, llm: LLM_MODE });
const show = (label, rows) => console.log(`\n# ${label}\n` + rows.slice(0, 5).map(e => JSON.stringify(e)).join('\n'));

if (QLOO_MODE === 'live') {
  const q = makeQloo(c => console.log('  ', c.status, c.path, `${c.ms}ms`));
  show('search place "Terra Kulture Lagos"', await q.search('Terra Kulture Lagos', 'urn:entity:place'));
  show('search artist "Fela Kuti"', await q.search('Fela Kuti', 'urn:entity:artist'));
  const fela = (await q.search('Fela Kuti', 'urn:entity:artist'))[0]?.id;
  show('places in Lagos for Fela fans 55+', await q.insights({
    'filter.type': 'urn:entity:place', 'filter.location.query': 'Lagos',
    'signal.interests.entities': fela, 'signal.location.query': 'Lagos', 'signal.demographics.age': '55_and_older', take: 5,
  }));
  show('artists for Lagos 55+, below mainstream', await q.insights({
    'filter.type': 'urn:entity:artist', 'signal.location.query': 'Lagos', 'signal.demographics.age': '55_and_older',
    'filter.popularity.max': 0.9, take: 5,
  }));
}

if (LLM_MODE === 'live') {
  for (const model of [TARGET_MODEL, AUDITOR_MODEL]) {
    const r = await chat({ model, json: true, messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }] });
    console.log(`\n# ${model}:`, r.content.slice(0, 80));
  }
}
