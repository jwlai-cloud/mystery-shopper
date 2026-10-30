// Offline self-check: run a full audit against mock Qloo + mock LLM and assert the pipeline behaves.
// Run: node test.mjs   (unset QLOO_API_KEY / LLM_API_KEY to stay offline)
import assert from 'node:assert/strict';
import { runAudit } from './lib/audit.mjs';

delete process.env.QLOO_API_KEY; delete process.env.LLM_API_KEY;
const events = [];
const s = await runAudit({ emit: (type, data) => events.push({ type, data }) });
const recs = events.filter(e => e.type === 'rec').map(e => e.data);

assert.ok(recs.some(r => r.verdict === 'phantom'), 'baseline phantom detected');
assert.ok(recs.some(r => r.verdict === 'elsewhere'), 'out-of-city place detected');
assert.ok(recs.some(r => r.verdict === 'mainstream'), 'mainstream pick detected');
assert.ok(events.some(e => e.type === 'adapt'), 'agent probed the worst segment again');
assert.ok(events.some(e => e.type === 'tool'), 'stage 2 target called the Qloo tool');
assert.ok(s.baseline.failRate > s['prompt-fix'].failRate, 'prompt fix lowers failures');
assert.ok(s['prompt-fix'].failRate >= s['qloo-tool'].failRate, 'qloo tool does not regress');
assert.ok(s['qloo-tool'].phantom === 0, 'no phantoms with the Qloo tool');
console.log('ok', JSON.stringify(s, null, 1));
