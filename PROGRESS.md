# Progress

Deadline: **Oct 30, 23:45 ET**. Idea and decisions: private BRAINSTORM.md (gitignored).

## Done
- Engine: probe → extract → grade → adaptive worst-segment probe → prompt-only repair → Qloo-tool repair → metrics.
- Grading fitted to real Qloo shapes (10-31): `properties.geocode` city check, city-relative mainstream (city's top-25 by popularity; artists ≥ 0.995), strict name match, unverified vs elsewhere.
- 5 segments with seeds that resolve in Qloo (Lagos, Austin, Osaka, Mexico City, Lisbon).
- Cheap models: target `openai/gpt-6-luna`, auditor `deepseek/deepseek-v4.1-flash`.
- Recorded live audit 2026-10-31T02-46-20Z: failures 22% → 23% (prompt fix) → 19% (Qloo tool), affinity 0.913 → 0.924 → 0.932.
- Deployed on Cloud Run (personal project `agent-era`, us-central1, max 1 instance): https://mystery-shopper-320877670799.us-central1.run.app. Recorded live runs ship in the private image, never in git.
- First-visit guided tour, security headers, repo public with MIT licence and demo link in About.

## Next
1. Optional: redesign (three directions first), demo video with Cloud TTS voice.
2. Point it at a team's own assistant endpoint; run it in CI.
