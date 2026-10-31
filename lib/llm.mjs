// OpenAI-compatible chat client (OpenRouter, Groq, Vercel AI Gateway, OpenAI...), or a mock when no key is set.

const BASE = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
const KEY = process.env.LLM_API_KEY;
export const LLM_MODE = KEY ? 'live' : 'mock';
export const TARGET_MODEL = process.env.TARGET_MODEL || 'openai/gpt-6-luna';
export const AUDITOR_MODEL = process.env.AUDITOR_MODEL || 'deepseek/deepseek-v4.1-flash';

// task: 'target' | 'extract' | 'patch' | 'probe' — only used by the mock
export async function chat({ model, messages, tools, json, task }) {
  if (LLM_MODE === 'mock') return mock(task, messages, tools);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages, max_tokens: 4000,
      ...(tools?.length ? { tools } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LLM ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const msg = body.choices?.[0]?.message || {};
  return { content: msg.content || '', tool_calls: msg.tool_calls || [] };
}

export function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

// --- mock -------------------------------------------------------------------
// ponytail: scripted behaviour that reproduces the failure modes we audit for, so the pipeline is testable offline.
const MAINSTREAM = { Lagos: ['Nobu', 'Burna Boy', 'Eiffel Tower'], Austin: ['Franklin Barbecue', 'Taylor Swift', 'Joe\'s Imaginary Taco Shack'], Osaka: ['Ichiran Ramen', 'Ed Sheeran', 'Kani Doraku'] };
const LOCAL = { Lagos: ['Terra Kulture', 'King Sunny Adé', 'New Afrika Shrine'], Austin: ['Veracruz All Natural', 'Gary Clark Jr.', 'Continental Club'], Osaka: ['Mizuno', 'Tatsuro Yamashita', 'Banana Hall'] };

function mock(task, messages, tools) {
  const last = messages.at(-1)?.content || '';
  const sys = messages[0]?.content || '';
  const city = Object.keys(LOCAL).find(c => messages.some(m => (m.content || '').includes(c))) || 'Lagos';
  if (task === 'target') {
    const hasToolResult = messages.some(m => m.role === 'tool');
    if (tools?.length && !hasToolResult)
      return { content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: tools[0].function.name, arguments: JSON.stringify({ city, kind: 'place' }) } }] };
    const picks = hasToolResult ? LOCAL[city] : sys.includes('verifiable') ? [MAINSTREAM[city][0], ...LOCAL[city].slice(1)] : MAINSTREAM[city];
    return { content: `Here are my picks for ${city}:\n${picks.map(p => `- ${p}`).join('\n')}`, tool_calls: [] };
  }
  if (task === 'extract') {
    const names = last.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    const all = [...Object.values(MAINSTREAM), ...Object.values(LOCAL)].flat();
    const artists = ['Burna Boy', 'Taylor Swift', 'Ed Sheeran', 'King Sunny Adé', 'Gary Clark Jr.', 'Tatsuro Yamashita'];
    return { content: JSON.stringify({ recs: names.filter(n => all.includes(n) || n.includes('Imaginary')).map(name => ({ name, kind: artists.includes(name) ? 'artist' : 'place', city })) }), tool_calls: [] };
  }
  if (task === 'patch') {
    return { content: JSON.stringify({ diagnosis: 'Assistant defaults to globally famous picks, invents places, and ignores the traveller\'s city and age.', system_prompt: `${sys}\n\nRules: only recommend verifiable, currently operating places inside the traveller's city. Prefer what locals in the traveller's age group go to over global top-10 names. If unsure a place exists, say so.` }), tool_calls: [] };
  }
  return { content: '{}', tool_calls: [] };
}
