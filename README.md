# Mystery Shopper

**Test shoppers for AI assistants, built from Qloo's taste graph.** Mystery Shopper sends Qloo-grounded audience probes at an AI travel concierge, checks every recommendation against Qloo, digs into the worst-served segment, then repairs the assistant and proves the repair worked.

Built for the Qloo Agentic Hackathon 2026. MIT licence.

## The problem

Travel and booking apps are shipping AI concierges. Nobody checks whether the recommendations fit the people asking. In practice the assistant:

- recommends places that don't exist (**phantoms**),
- recommends places in the wrong city (**elsewhere**),
- gives everyone the same famous names from the city's tourist list, whatever their age or taste (**mainstream collapse**).

The buyer is the team that owns an AI concierge at a travel or booking app. Today they have no way to catch these failures by segment.

## What the agent does

1. **Probe.** For each audience segment (a city, an age band, two taste seeds), a test shopper holds a two-turn conversation with the target assistant. The second turn pushes back: "Where do people around my age actually go?"
2. **Grade.** An auditor LLM extracts every named recommendation. Each one is checked against Qloo:
   - `GET /search` (with the city for places): does the entity exist? → PHANTOM
   - the resolved entity's address/geocode: is the place in the shopper's city? → ELSEWHERE
   - popularity → MAINSTREAM. Qloo's `popularity` is a percentile over its whole catalogue, so almost every real place in a big city scores above 0.98 and a fixed cut is meaningless. A place counts as mainstream when it is at least as popular as the city's 25th most popular place in Qloo (`/v2/insights` with `filter.location.query`, no signals), i.e. it is on the city's tourist list. An artist counts as mainstream at percentile ≥ 0.995 (Taylor Swift, Ed Sheeran, BTS and Willie Nelson are in; Fela Kuti and Burna Boy are not). Artists the shopper named themselves are not graded.
   - `GET /v2/insights` with `filter.results.entities` set to the recommendations, plus `signal.interests.entities` (the seeds), `signal.location.query` and `signal.demographics.age` → aggregate Qloo affinity, shown separately
3. **Dig in (agentic step).** The agent finds the segment with the highest failure rate, asks Qloo which lesser-known artists that audience likes (`signal.location.query`, `signal.demographics.age`, the segment's seeds, `filter.popularity.max=0.9`), and writes a new probe with those seeds.
4. **Repair, stage 1 (no Qloo).** The auditor reads the failures and rewrites the target's system prompt. Every probe runs again.
5. **Repair, stage 2 (Qloo tool).** The patched assistant gets a `qloo_local_taste` tool backed by `/v2/insights` (place results limited to the city with `filter.location.query`). Every probe runs again.
6. **Report.** A scorecard with before/after for each stage, every recommendation stamped with its verdict and Qloo evidence, and an agent log.

## Why it needs Qloo

An LLM grading another LLM's taste is circular. Qloo provides an independent catalogue (does it exist, where is it, how popular is it) and aggregate affinity by city and age band. Without Qloo there are no checks, no adaptive seeds and no stage-2 fix.

**Avoiding self-grading.** Stage 1 uses no Qloo, so its lift on the factual checks cannot come from grading with the fix. Stage 2 uses Qloo, and its affinity score is labelled as such.

## Run it

Node 22+, no dependencies.

```bash
npm test            # offline self-check against mock Qloo + mock LLM
npm run record      # run a full audit and save it to runs/ for replay
npm start           # http://localhost:3000
```

Without keys, everything runs against a small mock world. For live runs, copy `.env.example` and set:

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY` | Qloo hackathon key (server-side only) |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` |
| `LLM_API_KEY`, `LLM_BASE_URL` | Any OpenAI-compatible endpoint (OpenRouter by default) |
| `TARGET_MODEL` | The assistant under test |
| `AUDITOR_MODEL` | Extracts recommendations and writes the patch |
| `LIVE_DAILY_CAP` | Live audits allowed per day (one at a time) |

## Deploy

Any container host with Node 22 (Render, Fly, Railway). Start command `npm start`; the server reads `PORT`. Set the keys as server-side environment variables only. Recorded live runs (`runs/*-live.json`) contain Qloo data, so they are not in this repository: upload them as private files on the host (for example Render secret files, which appear under `/etc/secrets`) and set `RUNS_EXTRA_DIR=/etc/secrets`. Keep `LIVE_DAILY_CAP` low and set a credit limit on the LLM key.

## Layout

| File | What |
|---|---|
| `lib/audit.mjs` | The agent: probes, grading, adaptive step, two-stage repair, metrics |
| `lib/qloo.mjs` | Qloo REST client (live) and a mock world (offline) |
| `lib/llm.mjs` | OpenAI-compatible chat client with tool calls, plus a mock |
| `server.mjs` | Static UI, recorded runs, live audit over SSE |
| `public/index.html` | The whole UI |
| `test.mjs` | Offline assertions over a full audit |

## Limitations: what a result does not establish

- Segments are aggregate audiences, not people. Qloo results describe what groups tend to like, not what one traveller will do. No personal data is sent to Qloo.
- PHANTOM means Qloo's catalogue has no match. That is strong evidence, not proof, that a place doesn't exist.
- Small n. A demo audit is about 4 segments × 2 turns. The scorecard shows n, and the results are findings, not a benchmark.
- Name matching is normalised string matching, so unusual spellings can produce false phantoms.
- Recorded live runs contain Qloo response data, so they are kept out of this repository.
