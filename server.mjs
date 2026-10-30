// HTTP server: static UI, recorded runs, and a capped live audit streamed over SSE.
//   node server.mjs            serve on $PORT (default 3000)
//   node server.mjs --record   run a full audit and save it to runs/ for replay
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { runAudit, SEGMENTS } from './lib/audit.mjs';
import { QLOO_MODE } from './lib/qloo.mjs';
import { LLM_MODE } from './lib/llm.mjs';

const RUNS = new URL('./runs/', import.meta.url);
await mkdir(RUNS, { recursive: true });

async function recordAudit(opts, onEvent) {
  const t0 = Date.now(), events = [];
  const emit = (type, data) => { const e = { t: Date.now() - t0, type, data }; events.push(e); onEvent?.(e); };
  try { await runAudit({ ...opts, emit }); } catch (err) { emit('error', { message: String(err.message || err) }); }
  const id = new Date().toISOString().replace(/[:.]/g, '-') + `-${QLOO_MODE}`;
  await writeFile(new URL(`${id}.json`, RUNS), JSON.stringify({ id, qloo: QLOO_MODE, llm: LLM_MODE, events }));
  return id;
}

if (process.argv.includes('--record')) {
  const id = await recordAudit({}, e => e.type !== 'qloo' && console.log(e.t, e.type, JSON.stringify(e.data).slice(0, 140)));
  console.log('saved', id);
  process.exit(0);
}

// ponytail: one live audit at a time + daily cap; per-IP limits if abuse shows up
let liveBusy = false, liveDay = '', liveCount = 0;
const LIVE_CAP = +(process.env.LIVE_DAILY_CAP || 40);

const send = (res, code, body, type = 'application/json') =>
  res.writeHead(code, { 'Content-Type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/') return send(res, 200, await readFile(new URL('./public/index.html', import.meta.url), 'utf8'), 'text/html; charset=utf-8');
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, qloo: QLOO_MODE, llm: LLM_MODE, liveBusy, liveCount, liveCap: LIVE_CAP });
    if (url.pathname === '/api/runs') {
      const files = (await readdir(RUNS)).filter(f => f.endsWith('.json')).sort().reverse();
      return send(res, 200, files.map(f => f.replace('.json', '')));
    }
    const m = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
    if (m) return send(res, 200, await readFile(new URL(`${m[1]}.json`, RUNS), 'utf8'));

    if (url.pathname === '/api/live') {
      const today = new Date().toISOString().slice(0, 10);
      if (liveDay !== today) { liveDay = today; liveCount = 0; }
      if (liveBusy) return send(res, 429, { error: 'Another live audit is running. Replay a recorded one, or try again in a minute.' });
      if (liveCount >= LIVE_CAP) return send(res, 429, { error: 'Daily live-audit cap reached. Recorded audits still work.' });
      const ids = (url.searchParams.get('segs') || 'lagos-55').split(',').slice(0, 2);
      const segments = SEGMENTS.filter(s => ids.includes(s.id));
      if (!segments.length) return send(res, 400, { error: 'unknown segment' });
      liveBusy = true; liveCount++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      try {
        const id = await recordAudit({ segments, turns: 1, adaptive: false }, e => res.write(`data: ${JSON.stringify(e)}\n\n`));
        res.write(`data: ${JSON.stringify({ type: 'saved', data: { id } })}\n\n`);
      } finally { liveBusy = false; res.end(); }
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: String(err.message || err) });
  }
}).listen(+(process.env.PORT || 3000), () => console.log(`Mystery Shopper on :${process.env.PORT || 3000} (qloo=${QLOO_MODE}, llm=${LLM_MODE})`));
