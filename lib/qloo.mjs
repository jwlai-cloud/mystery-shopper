// Qloo client: live REST against the hackathon API, or a small deterministic mock world.
// Every call is recorded with its query (never the key) so the UI can show provenance.

const BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const KEY = process.env.QLOO_API_KEY;
export const QLOO_MODE = KEY ? 'live' : 'mock';

function results(body, key) {
  const r = body?.results;
  return Array.isArray(r) ? r : r?.[key] ?? [];
}

export async function get(path, query, log) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const started = Date.now();
  let body, status;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'X-Api-Key': KEY }, signal: AbortSignal.timeout(20000) });
    status = res.status;
    body = await res.json().catch(() => ({}));
    if (status !== 429 && status < 500) break;
    await new Promise(r => setTimeout(r, 500 * attempt));
  }
  log?.({ path, query, status, ms: Date.now() - started });
  if (status >= 400) throw new Error(`Qloo ${path} ${status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

export function compact(e) {
  const p = e.properties || {};
  return {
    id: e.entity_id || e.id,
    name: e.name,
    type: e.subtype || e.type,
    popularity: e.popularity,
    affinity: e.query?.affinity,
    address: p.address,
    geocode: p.geocode,
  };
}

export function makeQloo(log) {
  if (QLOO_MODE === 'mock') return mockQloo(log);
  return {
    mode: 'live',
    async search(query, type) {
      const body = await get('/search', { query, types: type, take: 5 }, log);
      return results(body, 'entities').map(compact);
    },
    async insights(query) {
      const body = await get('/v2/insights', query, log);
      return results(body, 'entities').map(compact);
    },
  };
}

// --- mock world -------------------------------------------------------------
// ponytail: tiny fixture world so the whole pipeline runs offline; replace with recorded live runs for the demo.
const W = [
  // name, type, city, popularity
  ['Nobu', 'place', 'Lagos', 0.99], ['Terra Kulture', 'place', 'Lagos', 0.62], ['Nok by Alara', 'place', 'Lagos', 0.71],
  ['Bukka Hut', 'place', 'Lagos', 0.55], ['New Afrika Shrine', 'place', 'Lagos', 0.83], ['Eiffel Tower', 'place', 'Paris', 0.999],
  ['Franklin Barbecue', 'place', 'Austin', 0.97], ['Continental Club', 'place', 'Austin', 0.78], ['Veracruz All Natural', 'place', 'Austin', 0.74],
  ['Broken Spoke', 'place', 'Austin', 0.69], ['Ichiran Ramen', 'place', 'Osaka', 0.96], ['Kani Doraku', 'place', 'Osaka', 0.93],
  ['Mizuno', 'place', 'Osaka', 0.66], ['Banana Hall', 'place', 'Osaka', 0.58],
  ['Taylor Swift', 'artist', null, 0.999], ['Burna Boy', 'artist', null, 0.97], ['Fela Kuti', 'artist', null, 0.88],
  ['King Sunny Adé', 'artist', null, 0.64], ['Ebenezer Obey', 'artist', null, 0.52], ['Willie Nelson', 'artist', null, 0.91],
  ['Gary Clark Jr.', 'artist', null, 0.77], ['Tatsuro Yamashita', 'artist', null, 0.73], ['Mariya Takeuchi', 'artist', null, 0.7],
  ['Ed Sheeran', 'artist', null, 0.998],
].map(([name, t, city, popularity], i) => ({
  id: `mock-${i}`, name, type: `urn:entity:${t}`, popularity,
  address: city ? `${city}` : undefined, geocode: city ? { city } : undefined,
}));

function mockQloo(log) {
  const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').trim();
  return {
    mode: 'mock',
    async search(query, type) {
      log?.({ path: '/search', query: { query, types: type }, status: 200, ms: 1 });
      return W.filter(e => (!type || e.type === type) && norm(e.name).includes(norm(query).split(' ').slice(0, 2).join(' ')));
    },
    async insights(q) {
      log?.({ path: '/v2/insights', query: q, status: 200, ms: 1 });
      let out = W.filter(e => e.type === q['filter.type']);
      if (q['filter.results.entities']) out = out.filter(e => q['filter.results.entities'].includes(e.id));
      const city = q['signal.location.query'] || q['filter.location.query'];
      if (q['filter.location.query']) out = out.filter(e => e.geocode?.city === city);
      if (q['filter.popularity.max'] !== undefined) out = out.filter(e => e.popularity <= q['filter.popularity.max']);
      // mock affinity: local and less mainstream scores higher for a segment
      return out.map(e => ({ ...e, affinity: +((e.geocode?.city === city ? 0.5 : 0.2) + (1 - e.popularity) * 0.5).toFixed(3) }))
        .sort((a, b) => b.affinity - a.affinity).slice(0, q.take || 10);
    },
  };
}
