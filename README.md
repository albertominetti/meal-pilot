# MealPilot

MealPilot is a **NestJS + TypeScript JSON API** that matches **already-published YouTube meal videos** to a user's health profile.

You send a health description (free text) plus structured fields — blood pressure, food restrictions (vegan, vegetarian, gluten-free, …) and a list of **allergies** — and the API returns a ranked list of YouTube videos, each with a per-video explanation of *why it fits* the meal plan given that health data.

A **Gemini agent** searches YouTube, watches candidate videos (real video understanding, not title guessing) and selects a plan. Allergy safety is enforced deterministically on the server. Analyses are cached, so repeat requests are fast and free. Without keys, the API runs fully offline on a clearly labelled mock.

> **Medical disclaimer (informational only, not medical advice).**
> MealPilot does not provide medical advice, diagnosis, or treatment. Always consult a qualified health professional before changing your diet — especially with hypertension, diabetes, allergies, or other conditions. Allergy information here is best-effort analysis, never a guarantee of safety.

## How it works

There are two endpoints that share the same building blocks:

**`POST /api/meal-plan/agent` (agentic).** A Gemini agent (Interactions API, function calling) plans the work itself:

1. `list_known_videos`: reuse earlier analyses and the user's own candidates.
2. `search_videos`: YouTube Data API search built from the profile. Only offered when `YOUTUBE_API_KEY` is set.
3. `analyze_video`: Gemini watches the actual YouTube video and returns ingredients, steps, EU-14 allergens with evidence, sodium sources and tags. The **server** then computes the allergy verdict.
4. `submit_plan`: the server rejects any video that wasn't analyzed or isn't `safe`, plus duplicates and over-limit plans. The model then fixes its plan and resubmits.

The server enforces budgets (steps, searches, analyses, wall-clock) and forces `submit_plan` on the final turn. If anything fails, it falls back to the deterministic planner (`agent.fallbackUsed`). Allergy verdicts, tags and the disclaimer always come from code, never from the model.

**`POST /api/meal-plan` (deterministic).** It analyzes the given candidates in order until `maxResults` safe matches are found:

- Without candidates in live mode, it searches YouTube with a query derived from the profile.
- In mock mode, it uses the demo seed list instead.
- Explanations are templated.

Both endpoints go through `VideoAnalysisService`, which looks up the cache first and then calls Gemini (live) or the title-keyword mock (offline).

### Modes

| `MEALPILOT_LLM_MODE` | Behaviour |
|---|---|
| `auto` (default) | live when `GEMINI_API_KEY` is set, otherwise mock |
| `live` | requires a key (boot fails without one). Gemini errors make a video `unavailable`, and it is excluded as "needs review". **Never** silently replaced by mock data |
| `mock` | no network: title-keyword analysis (`provider: "mock"`, `coverage: "partial"`). The agent endpoint uses the deterministic planner |

`GET /api/health` shows the effective mode and model. Every response carries `meta.provider`/`meta.model`.

## Endpoints

Interactive docs (Swagger UI): `GET /api/docs`

### `POST /api/meal-plan/agent`

```bash
curl -X POST http://localhost:3000/api/meal-plan/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, type 2 diabetes",
    "bloodPressure": "145/92",
    "restrictions": ["vegetarian"],
    "allergies": ["peanuts", "sesame"],
    "preferences": "quick weeknight dinners",
    "maxResults": 3,
    "locale": "de",
    "debug": true
  }'
```

The response has the same shape as `/api/meal-plan`, plus:

```json
{
  "agent": { "steps": 5, "searches": 2, "analyses": 6, "fallbackUsed": false, "agentNotes": "...", "inputTokens": 41230, "outputTokens": 2210, "youtubeQuotaUsed": 202 },
  "trace": [ { "step": 1, "tool": "list_known_videos", "args": {}, "ok": true, "summary": "0 cached, 0 candidates", "durationMs": 3 } ]
}
```

`trace` is only included with `debug: true`. The endpoint is rate-limited to 5 requests/min per IP and can take 30–150 s.

### `POST /api/meal-plan`

```bash
curl -X POST http://localhost:3000/api/meal-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, type 2 diabetes, trying to eat low sodium",
    "bloodPressure": "140/90",
    "restrictions": ["vegetarian", "gluten-free"],
    "allergies": ["peanuts", "shellfish"],
    "videoCandidates": [ { "idOrUrl": "https://www.youtube.com/watch?v=<id>" } ],
    "maxResults": 5
  }'
```

```json
{
  "recommendations": [
    {
      "videoId": "...", "url": "...", "title": "...", "channel": "...",
      "whyItFits": "...", "matchedTags": ["low-sodium", "vegetarian"],
      "allergySafety": { "status": "safe", "notes": "No match for declared allergies..." },
      "healthNotes": "Signals: ... Sodium sources to reduce or swap: soy sauce. ...",
      "provider": "gemini"
    }
  ],
  "excluded": [ { "videoId": "...", "url": "...", "title": "...", "reason": "Blocked: Detected allergen match: peanuts (peanuts, confirmed: peanut butter at 01:20)..." } ],
  "disclaimer": "Informational only, not medical advice...",
  "meta": { "mode": "live", "provider": "gemini", "model": "gemini-3.8-flash", "analyzed": 3, "fromCache": 1, "failures": [], "durationMs": 21450 }
}
```

### `GET /api/health`

```json
{ "status": "ok", "service": "meal-pilot", "llm": { "mode": "live", "modeSetting": "auto", "model": "gemini-3.8-flash", "analysisModel": "gemini-3.8-flash", "youtubeSearch": true } }
```

### `GET /api/videos/cache`, `DELETE /api/videos/cache`, `DELETE /api/videos/cache/:videoId`

List or clear cached analyses. Clearing one video removes all of its provider/model variants.

## Environment variables

`.env` is loaded automatically (via `@nestjs/config`, but not in tests). See `.env.example` for every option.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MEALPILOT_LLM_MODE` | `auto` | `auto` / `live` / `mock` (see Modes) |
| `GEMINI_API_KEY` | — | Gemini API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Agent model (and analysis model unless overridden) |
| `GEMINI_ANALYSIS_MODEL` | `GEMINI_MODEL` | Model for per-video analysis |
| `GEMINI_VIDEO_RESOLUTION` | `low` | Video input resolution (`low` is cheapest) |
| `YOUTUBE_API_KEY` | — | Enables YouTube search plus real titles and privacy checks for candidates |
| `YOUTUBE_DAILY_QUOTA` | `9000` | Local guard on quota units/day (search = 100, details = 1) |
| `MAX_VIDEO_MINUTES` | `25` | Longer videos are skipped (cost) |
| `AGENT_MAX_STEPS` / `AGENT_MAX_SEARCHES` / `AGENT_MAX_ANALYSES` / `AGENT_TIMEOUT_MS` | `12` / `4` / `8` / `150000` | Agent budgets |
| `ANALYSIS_CONCURRENCY` | `3` | Parallel video analyses |
| `MEALPILOT_CACHE_DIR` / `CACHE_TTL_DAYS` | `data/cache` / `30` | Analysis cache location and expiry (0 = never) |

## Design notes

- **LLM layer** (`src/llm/`): `LlmClient` is a thin interface over `@google/genai` Interactions (`GenAiLlmClient`). Requests use `store: false`, so health profiles aren't retained by Google, and the agent resends its full step history (including thought signatures) each turn. 429, 5xx and timeouts retry with backoff. In mock mode a `DisabledLlmClient` makes any accidental live call fail loudly.
- **Video analysis** (`src/videos/analyzers/`): `GeminiVideoAnalyzer` sends the YouTube URL as a `video` input with a JSON-Schema `response_format`, validates with zod (`analysis.schema.ts`, schema v2) and retries once on invalid output. `MockVideoAnalyzer` is the offline keyword analyzer.
- **Cache** (`transcript-cache.service.ts`): files are named `data/cache/<videoId>__<provider>__<model>__v<schema>.json`. Mock results are never served in live mode, failed analyses are never cached, and entries expire after `CACHE_TTL_DAYS`. Render's free disk is ephemeral, so the cache resets on deploy or restart.
- **YouTube** (`src/youtube/youtube.service.ts`): `search.list` and `videos.list` via `fetch`, with strict SafeSearch and 4–20 min videos, keeping only public videos. Searches are cached for 24 h, and a daily quota guard stops calls before the limit.
- **Agent** (`src/agent/`):
  - `agent.tools.ts`: tool definitions with zod-validated arguments; tool errors go back to the model as results.
  - `agent.service.ts`: the loop, budgets, forced final turn and fallback.
  - `agent.prompt.ts`: the system prompt. The profile is passed as JSON data, and tool output is treated as untrusted.

## Allergy-safety rules

This is the safety-critical path: `src/safety/allergy-safety.ts` and `src/videos/allergy.util.ts`. It is deterministic and never delegated to the LLM.

User allergies are free text. They map to the **14 EU allergen categories** (Reg. 1169/2011) and are expanded with aliases, for example `shellfish` → crustaceans + molluscs, `wheat` → gluten, and `soy sauce` → soybeans + gluten. Matching is deliberately conservative, so over-blocking is acceptable.

| Condition | Verdict |
|---|---|
| analysis unavailable (Gemini error, private video…) | uncertain → excluded |
| allergen finding `confirmed`/`likely` matching a user allergy | **unsafe** → blocked |
| alias hit in recipe name / ingredients / steps / sodium sources | **unsafe** → blocked |
| allergen finding `possible` | uncertain → excluded |
| alias hit in cross-contact notes or summary | uncertain → excluded |
| partial coverage or mock provider + severe allergy (nuts, shellfish, fish, sesame, milk, egg, soy, lupin, mustard, celery) | uncertain → excluded |
| otherwise | safe (with a "verify the recipe" note) |

Only `safe` videos can be recommended, by either endpoint. Every response includes the medical disclaimer.

## Local development

Requires Node 22.

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY (and optionally YOUTUBE_API_KEY)
npm run start:dev      # watch mode, http://localhost:3000/api
npm test               # unit tests (offline: fake Gemini/YouTube clients)
npm run test:e2e       # API tests (offline mock mode + scripted live agent)
npm run lint
npm run smoke:live                     # real Gemini: full agent run with a sample profile
npm run smoke:live -- --video <id|url> # real Gemini: analyze one video
npm run eval:analysis                  # allergen recall on eval/videos.labeled.json
```

**Before relying on live mode**, label 10–15 real videos in `eval/videos.labeled.json` (see `eval/videos.labeled.example.json`) and run `npm run eval:analysis`. It exits non-zero unless recall on labelled allergens is 100%.

## Deploy on Render

The repo ships a Render Blueprint (`render.yaml`) defining one free Web Service (`meal-pilot`, region Frankfurt, runtime Node 22):

- Build: `npm ci && npm run build` — Start: `npm start` — Health check: `GET /api/health`.
- The port comes from Render's `PORT` env var (see `src/main.ts`); no extra config needed.
- The service landing page `GET /` redirects to the Swagger UI at `/api/docs` — that is the test UI (no frontend).

Steps in the Render dashboard:

1. **New -> Blueprint**, connect/select the `meal-pilot` repo and apply the Blueprint.
2. When prompted for env vars, set `GEMINI_API_KEY` (leave empty for the offline mock) and optionally `YOUTUBE_API_KEY` (enables search). Model and agent budgets are preset in `render.yaml`.
3. **Deploy**. Open the service URL: `/` lands on Swagger UI; `/api/health` must return `{ "status": "ok" }`.

> Free-plan note: the service sleeps after inactivity, so the first request after idle can take ~30-60s (cold start). The file cache (`data/cache/`) is ephemeral on Render, so cached analyses reset on each deploy/restart and live mode pays for re-analysis. Agent requests can run for up to `AGENT_TIMEOUT_MS`.
>
> Privacy: profile text and video URLs are sent to Google Gemini with `store: false` (not retained for later retrieval).

## Project structure

```text
src/
  main.ts                          # bootstrap, /api prefix, validation, Swagger
  app.module.ts                    # ConfigModule (.env), throttling, providers
  config/app-config.service.ts     # typed env + boot validation
  llm/                             # LlmClient interface, GenAI Interactions client, module
  agent/                           # POST /api/meal-plan/agent: tools, loop, prompt, DTOs
  meal-plan/                       # POST /api/meal-plan, profile-fit helpers, DTOs
  safety/allergy-safety.ts         # deterministic allergy verdicts (safety-critical)
  videos/
    analysis.schema.ts             # schema v2 (zod + JSON Schema), EU-14 allergens
    analyzers/                     # Gemini (real video) + mock analyzers
    video-analysis.service.ts      # cache-first orchestration, bounded concurrency
    transcript-cache.service.ts    # versioned file + memory cache
    allergy.util.ts                # aliases + EU-14 mapping (safety-critical)
    youtube.util.ts                # video-id extraction
  youtube/youtube.service.ts       # YouTube Data API v3 + quota guard
scripts/                           # smoke-live.ts, eval-analysis.ts (live, not in CI)
eval/                              # labelled videos for the allergen eval
test/                              # e2e + shared fakes (ScriptedLlmClient, FakeYouTube)
docs/plans/agentic-gemini.md       # design plan for the agentic integration
```

## Roadmap

- Streaming agent progress (SSE) for a UI.
- Persistent cache (Render Key Value/Postgres) instead of ephemeral disk.
- Per-user history and preference learning.
- Nutrition-API enrichment (per-serving macros/sodium estimates).
- Richer restriction engine (halal/kosher certification flags, FODMAP).
- Human review queue for `uncertain` allergy verdicts.
- API keys and structured request logging for production use.
- Docker image + CI workflow (build/test/lint on every PR).
