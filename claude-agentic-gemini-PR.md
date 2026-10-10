# PR: Agentic Gemini integration (Claude's version)

Branch: `claude/agentic-gemini` (base `main` @ 70bb5eb) · 1 commit · 51 files, +4570 / −720

## Open the PR from your Mac

The cloud session can't push to `albertominetti/meal-pilot`, so the branch comes as a git bundle. Run these in your own Terminal (not inside an agent) from the meal-pilot folder:

```bash
git fetch ./claude-agentic-gemini.bundle claude/agentic-gemini:claude/agentic-gemini
git push -u origin claude/agentic-gemini
gh pr create --base main --head claude/agentic-gemini \
  --title "feat: agentic Gemini integration (Claude version)" --body-file claude-agentic-gemini-PR.md
rm claude-agentic-gemini.bundle claude-agentic-gemini-PR.md   # once pushed
```

The fetch only creates a branch. It doesn't touch your working tree or the other agent's uncommitted changes.

To try it locally without disturbing the main working tree:

```bash
git worktree add ../meal-pilot-claude claude/agentic-gemini
cd ../meal-pilot-claude && npm ci && npm test && npm run test:e2e
```

---

## Summary

This implements `docs/plans/agentic-gemini.md`, phases 1–6.

- **Config:** `@nestjs/config` loads `.env` (previously it was never read, so the app always ran on the mock). Typed `AppConfig` with `MEALPILOT_LLM_MODE=auto|live|mock`; boot fails if `live` has no key. `GEMINI_MODEL` defaults to `gemini-3.8-flash`.
- **LLM layer** (`src/llm/`): `LlmClient` interface plus `GenAiLlmClient` on the `@google/genai` 2.x **Interactions API**:
  - `store: false`, so profiles aren't retained.
  - Full step history, including thought signatures, is resent every turn.
  - 429, 5xx and timeouts retry with backoff.
  - Removes the deprecated `@google/generative-ai`.
- **Real video analysis:** Gemini gets the YouTube URL as `video` input and returns schema-v2 JSON: EU-14 allergens with evidence, timestamp and confidence; steps; sodium sources; coverage. The output is validated with zod and retried once. **Failures become `unavailable` and the video is excluded. It is never silently replaced by mock data.** This fixes a safety bug.
- **Safety** (`src/safety/allergy-safety.ts`): a deterministic verdict table. User allergies map to the EU-14 categories, with new aliases for celery, mustard, lupin, sulphites and molluscs. Partial coverage or mock analysis combined with a severe allergy gives "needs review".
- **Cache v2:** keyed by provider + model + schema version, with a TTL. Failures are never cached, and mock entries are never served in live mode.
- **YouTube** (`src/youtube/`): Data API v3 search and details via `fetch`. Only public videos with strict SafeSearch, 4–25 min long; a local daily quota guard; 24 h search cache. It also replaces caller-supplied titles with real metadata.
- **Agent:** `POST /api/meal-plan/agent`.
  - Tools: `list_known_videos`, `search_videos` (only offered when `YOUTUBE_API_KEY` is set), `analyze_video` and `submit_plan`.
  - The server owns the budgets (steps, searches, analyses, wall clock) and forces `submit_plan` on the final turn.
  - It validates the plan: only videos analyzed and `safe` in this run are accepted.
  - It falls back to the deterministic planner if anything fails, and returns an optional `trace`.
  - The endpoint is limited to 5 requests/min per IP.
- **`POST /api/meal-plan`** keeps working. Analysis runs in parallel batches and responses include `meta` (mode, provider, model, cache hits, failures). In live mode without candidates it searches YouTube, or returns 400 if search isn't configured.

## Test plan

- [x] `npm test`: 64 unit tests, offline, using `ScriptedLlmClient` and `FakeYouTube` from `test/fakes.ts`. They cover:
  - the agent's happy path, rejected-then-corrected plans, budget exhaustion with a forced submit, invalid tool arguments, Gemini errors falling back, and search being hidden when not configured;
  - the safety table;
  - cache keying and TTL;
  - schema retry.
- [x] `npm run test:e2e`: 7 tests (mock mode, plus a live-mode agent loop using fakes).
- [x] `npm run lint` and `npm run build` are clean. The app boots in mock and live mode, and boot fails for `live` without a key.
- [x] SDK request shape checked against `@google/genai@2.28` with a local stub server (`POST /v1beta/interactions`, `store`, `tools`, `tool_choice.allowed_tools`, `response_format`, `video` input).
- [ ] **No real Gemini or YouTube calls yet.** Run `npm run smoke:live` and `npm run smoke:live -- --video <id>`.
- [ ] Label real videos in `eval/videos.labeled.json` and run `npm run eval:analysis`; recall must be 100% before using live mode by default.

## Comparing with the local implementation

- **Layout:** this version keeps the tools in a single `agent.tools.ts`. `check_profile_fit` is folded into the result of `analyze_video` to save a round trip per video.
- **Safety behaviour to compare:**
  - Does the other version also refuse to fall back to the mock in live mode?
  - Is the allergy verdict computed server-side and enforced in `submit_plan`?
- **Verification:** compare test coverage of the agent loop, especially budget exhaustion and malformed tool calls.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012esXgRYto7tTzMkwWodd8X
