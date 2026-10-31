# Mystery Shopper — Devpost text

**Live demo:** https://mystery-shopper-320877670799.us-central1.run.app (no login; opens on a recorded real audit, "Run live" runs a fresh one)
**Code:** https://github.com/jwlai-cloud/mystery-shopper (MIT)

## Inspiration
Travel and booking apps are shipping AI concierges, and nobody checks whether the recommendations fit the people asking, or even exist. My day job is telling bad bots from humans in ad traffic. This project builds good bots on purpose: test shoppers that audit someone else's AI assistant.

## What it does
1. **Probe.** For each audience segment (city × age band × two taste seeds), a test shopper holds a two-turn conversation with the target assistant. Turn two pushes back: "Those sound like the tourist list. Where do people around my age actually go?"
2. **Grade with Qloo, not an LLM.** An auditor LLM only transcribes the named places and artists. Every verdict comes from Qloo:
   - UNVERIFIED: `/search` finds no entity with that name in the shopper's city.
   - ELSEWHERE: the assistant sent the shopper to another city.
   - MAINSTREAM: a place at least as popular as the city's 25th most popular place in Qloo, or an artist in Qloo's global top 0.5%.
   - Aggregate affinity: `/v2/insights` scores the recommendations for the segment's location, age band and seeds. It is shown separately.
3. **Dig in.** The agent picks the worst segment, asks Qloo for lesser-known artists that audience likes (`filter.popularity.max=0.9`), and re-probes with them.
4. **Repair, stage 1 (no Qloo).** The auditor rewrites the assistant's system prompt from the failures. No Qloo is involved, so any lift here can't come from grading with the fix.
5. **Repair, stage 2 (Qloo tool).** The assistant gets a `qloo_local_taste` tool backed by `/v2/insights`. Every probe runs again.
6. **Report.** Scorecard per stage, every recommendation stamped with its verdict and Qloo evidence, and a log of every Qloo call.

## Which Qloo calls, and why
| Call | Why |
|---|---|
| `GET /search?query=<name> <city>&types=urn:entity:place` (then name-only if needed) | Does the recommended place exist, and where (`properties.geocode`)? |
| `GET /search?types=urn:entity:artist` | Resolve artists and seeds; strict name match, no guessing |
| `GET /v2/insights` `filter.type=place`, `filter.location.query=<city>`, `take=25` | The city's 25 most popular places: the "tourist list" cutoff |
| `GET /v2/insights` `filter.results.entities=<recs>`, `signal.interests.entities=<seeds>`, `signal.location.query`, `signal.demographics.age` | Aggregate affinity of what the assistant said, for that segment |
| `GET /v2/insights` `filter.type=artist`, location + age + seeds, `filter.popularity.max=0.9` | Lesser-known seeds for the adaptive re-probe |
| `GET /v2/insights` `filter.type=place`, `filter.location.query`, location + age + seeds | The stage-2 tool the repaired assistant can call |

## Walkthrough (redacted request → result)
Segment: Lagos, 55 and older, seeds Fela Kuti and King Sunny Adé.
- `GET /search?query=Terra Kulture Lagos&types=urn:entity:place` → Terra Kulture, geocode city Lagos, popularity 0.9934. Lagos's 25th most popular place is 0.9946, so the verdict is **OK**.
- `GET /search?query=Ikoyi Club 1938 Lagos&types=urn:entity:place` → no entity by that name → **UNVERIFIED**.
- `GET /v2/insights?filter.type=urn:entity:place&filter.location.query=Lagos&signal.interests.entities=<Fela Kuti id>&signal.location.query=Lagos&signal.demographics.age=55_and_older` → places such as EbonyLife Place, each with an affinity score. This is what the stage-2 tool returns.

## Results (one recorded run, 5 segments + 1 adaptive)
Target `openai/gpt-6-luna`, auditor `deepseek/deepseek-v4.1-flash`.

| Stage | Recs | Any failure | Qloo affinity |
|---|---|---|---|
| Baseline | 51 | 22% | 0.913 |
| Prompt fix (no Qloo) | 60 | 23% | 0.924 |
| Qloo tool | 57 | 19% | 0.932 |

Read honestly: the prompt-only fix did not reduce failures. The Qloo tool raised affinity and slightly lowered failures. Runs vary a lot at this n; an earlier run with the same models had the tool stage at 5% failures and 0.966 affinity. Osaka was the worst-served segment in every run.

## How we built it
Zero-dependency Node 22: one server file, three library files and one HTML page. It talks to any OpenAI-compatible LLM endpoint (OpenRouter here). Live audits stream over SSE and are capped at 5 a day. Recorded audits replay with no API cost. A mock Qloo and a mock LLM keep `npm test` running offline. It's hosted on Google Cloud Run, which scales to zero.

## Challenges
- Qloo `popularity` is a percentile over the whole catalogue: almost every real place in a big city scores above 0.98. A fixed "top 5%" cut flagged everything, so mainstream became city-relative.
- Free-text names vs a catalogue: "Museu do Fado" fuzzy-matched "Museu do Café" in Brazil, and "Uchi" in Austin matched a London "UCHI". Matching is now strict, and a same-name place in another city counts as unverified, not as the assistant's error.
- A rewritten prompt told the assistant to recommend only "verified" places, so it named nothing. The patch instruction now forbids referring to tools the assistant doesn't have.

## Limitations: what a result does not establish
- Segments are aggregate audiences, not people. No personal data is sent to Qloo.
- UNVERIFIED often means a gap in Qloo's coverage of a real local place. It means "can't be checked", not "doesn't exist".
- The stage-2 tool's picks come from Qloo, so it passes Qloo's existence check partly by construction. Affinity is the more meaningful stage-2 number.
- Small n. These are findings, not a benchmark.

## What's next
Point it at a team's own assistant endpoint, run it in CI, and add more segment types (dietary needs, accessibility, family travel).
