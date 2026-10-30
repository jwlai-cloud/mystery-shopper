# Progress

Deadline: **Oct 30, 23:45 ET**. Idea and decisions: private BRAINSTORM.md (gitignored).

## Done (10-29)
- Engine: probe → extract → grade (phantom / elsewhere / mainstream / affinity) → adaptive worst-segment probe → prompt-only repair → Qloo-tool repair → metrics.
- Qloo client (live REST, param names checked against the official harness 0.1.26) plus a mock world.
- OpenAI-compatible LLM client with tool calls, plus a mock.
- Server: recorded-run replay, capped live audit over SSE, health endpoint.
- UI: stage stepper, scorecard, segment cards with verdict stamps, agent log.
- `npm test` passes offline (baseline 92% fail → prompt fix 33% → Qloo tool 0% on mocks).

## Next
1. **Qloo key arrives** → probe live: `/search` with city for places, `geocode` shape, `popularity` scale, `filter.location.query` behaviour. Fix grading against real shapes.
2. **LLM key** (OpenRouter; put it in .env, then `npm run probe`) → first real audit, `npm run record`.
3. Replace the mock seeds with seeds that resolve well in Qloo. Consider 4–6 segments.
4. Deploy on a container host (Render/Fly/Railway). Recorded live runs ship from a private source, not the public repo.
5. Optional: swap the stage-2 tool for the official `qloo mcp` server.
6. Devpost text, public repo, licence in About.
