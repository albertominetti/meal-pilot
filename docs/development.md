# Development guide

How to run, test and extend MealPilot locally. Setup commands are also in the [README](../README.md#local-development--testing).

## Modes

`MEALPILOT_LLM_MODE` selects the LLM provider (`src/config/app-config.ts`):

| Mode | Behaviour |
|---|---|
| `auto` (default) | Live when `GEMINI_API_KEY` is set, mock otherwise |
| `live` | Gemini; startup fails without `GEMINI_API_KEY` |
| `mock` | No network calls to Gemini: `MockLlmClient` and `MockVideoAnalyzer` |

YouTube is selected separately. With `YOUTUBE_API_KEY` set, `YouTubeService` calls the Data API; without it, `FakeYouTubeService` serves canned videos (`src/youtube/fake-youtube.service.ts`). The canned videos are real public videos, so their watch URLs resolve. Their channel IDs and descriptions are offline fixtures: the descriptions hold full ingredient lists, so the mock analyzer returns quantities with `source: "description"`. Tests that need a special case, such as an allergen named only in the description, add their own video with `addVideo`.

## Tests

```bash
npm test            # unit tests, offline, no keys
npm run test:e2e    # whole app in mock mode (forces YOUTUBE_API_KEY empty)
npm run lint
npm run build
```

Conventions:
- Pure logic (`src/recipes/`, `src/shopping/`, `profile-fit.ts`) has table-driven specs next to the code.
- Shared analysis fixtures live in `test/fixtures/analysis.ts`. That keeps them out of the build, which excludes `test/` and `*.spec.ts`.
- Agent behaviour is tested with `ScriptedLlmClient` in `src/agent/agent.service.spec.ts`: queue the function calls the model makes, then assert on the tool results it received (`resultsSeenOnTurn`) and on the final response.
- Tests that touch the cache set `MEALPILOT_CACHE_DIR` to a temp directory, so nothing leaks into `data/cache/`.

## Analysis eval

```bash
npm run eval:analysis                 # eval/videos.labeled.json
npm run eval:analysis -- other.json   # another labelled set
```

The eval reports allergen recall, measured on the deterministic safety check. That is the gate: the run exits with code 1 if any labelled allergen is missed. It also reports unit accuracy and the share of quantities within ±20%.

With a Gemini key it runs live; it is not part of CI. `eval/videos.labeled.json` does not exist yet. It needs 10 or more real videos labelled by hand, in the format of `eval/videos.labeled.example.json`. Until then, the runner uses the example set built on the offline fixtures.

## Data files

| File | Purpose | Who edits it |
|---|---|---|
| `data/videos.seed.json` | Candidates for `POST /api/meal-plan` | Team |
| `data/trusted-channels.json` | `{ channelId, name, note }` for team-reviewed channels | Team, after review |
| `data/cache/` | Cached analyses, `<videoId>.<provider>.<model>.v<schema>.json` (gitignored) | The app |
| `eval/videos.labeled.json` | Ground truth for the eval | Team, by hand |

## Common changes

**Changing the analysis schema.** Edit `analysis.schema.ts`, covering both the Zod schema and `ANALYSIS_JSON_SCHEMA`, and bump `ANALYSIS_SCHEMA_VERSION`. The bump makes old cache entries stop matching automatically. Then update `MockVideoAnalyzer`, `MockLlmClient`, the fixtures and the Gemini prompt in `buildAnalysisPrompt`.

**Changing what "a good recipe" means.** Edit `RANKING_WEIGHTS` in `src/recipes/ranking.ts` and its spec, and keep the agent prompt (`src/agent/agent.prompt.ts`, step 5) in line with it.

**Adding an agent tool.** Implement `AgentTool` (a Zod schema plus a JSON schema for Gemini) in `src/agent/tools/`. Then register it in `agent.module.ts` and in the tools list in `AgentService.run`, and add it to the providers in `agent.service.spec.ts`. Tool results that carry video content must go through `sanitizeUntrusted` or the digest builder.

**Adding a shopping-list rule.** Add aliases and descriptors in `src/recipes/normalize.ts`, densities in `src/recipes/units.ts`, and sections and pantry staples in `src/shopping/sections.ts`. Each comes with a table row in its spec.

## Deployment

`render.yaml` deploys a single web service in Frankfurt. On Render's free plan the disk is ephemeral, so the analysis cache is lost on every restart. Phase 6 of the [gap plan](plans/close-concept-gaps.md) moves storage to Neon Postgres.
