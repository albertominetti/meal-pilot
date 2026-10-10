# MealPilot

MealPilot is a **NestJS + TypeScript JSON API** that matches **already-published YouTube meal videos** to a user's health profile.

You send a health description (free text) plus structured fields — blood pressure, food restrictions (vegan, vegetarian, gluten-free, …) and a list of **allergies** — and the API returns a ranked list of YouTube videos, each with a per-video explanation of *why it fits* the meal plan given that health data.

Video understanding combines **Gemini** (when an API key is configured) with internal video-transcript/recipe analysis, and every analyzed video is kept in a **persistent cache** so repeat requests are fast and free.

> **Medical disclaimer (informational only, not medical advice).**
> MealPilot does not provide medical advice, diagnosis, or treatment. Always consult a qualified health professional before changing your diet — especially with hypertension, diabetes, allergies, or other conditions. Allergy information here is best-effort analysis, never a guarantee of safety.

## How it works

1. `POST /api/meal-plan` receives the health profile + candidate YouTube videos (ids or URLs).
2. Each video is resolved to a YouTube id (`src/videos/youtube.util.ts` supports watch, `youtu.be`, shorts, and embed URLs).
3. `VideoAnalysisService` checks the `TranscriptCacheService` first; on a miss it calls `GeminiService` and persists the result.
4. `MealPlanService` evaluates **allergy safety** (hard-block on matches), matches restriction tags, and builds a per-video `whyItFits` explanation.
5. Safe videos go to `recommendations`; blocked/uncertain ones go to `excluded` with a reason. Every response carries the medical disclaimer.

If `videoCandidates` is empty, the API falls back to the committed demo seed list (`data/videos.seed.json`) so the endpoint is tryable with zero setup.

## Endpoints

Interactive docs (Swagger UI): `GET /api/docs`

### `GET /api/health`

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok", "service": "meal-pilot" }
```

### `POST /api/meal-plan`

```bash
curl -X POST http://localhost:3000/api/meal-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, type 2 diabetes, trying to eat low sodium",
    "bloodPressure": "140/90",
    "restrictions": ["vegetarian", "gluten-free"],
    "allergies": ["peanuts", "shellfish"],
    "preferences": "low sodium, quick dinners",
    "videoCandidates": [
      { "idOrUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Low-Sodium Veggie Stir Fry", "channel": "Healthy Kitchen" }
    ],
    "maxResults": 5
  }'
```

Response shape:

```json
{
  "recommendations": [
    {
      "videoId": "dQw4w9WgXcQ",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Low-Sodium Veggie Stir Fry",
      "channel": "Healthy Kitchen",
      "whyItFits": "Full explanation referencing the health profile, restrictions and tags...",
      "matchedTags": ["low-sodium", "vegetarian"],
      "allergySafety": { "status": "safe", "notes": "No match for declared allergies..." },
      "healthNotes": "Signals: low-sodium, whole-foods. ..."
    }
  ],
  "excluded": [
    { "videoId": "...", "url": "...", "title": "...", "reason": "Blocked: detected allergen match (peanuts)..." }
  ],
  "disclaimer": "Informational only, not medical advice. Consult a qualified health professional..."
}
```

### `GET /api/videos/cache`

Lists cached analyzed videos.

```bash
curl http://localhost:3000/api/videos/cache
```

```json
{ "count": 2, "items": [ { "videoId": "...", "title": "...", "provider": "mock", "analyzedAt": "..." } ] }
```

### `DELETE /api/videos/cache` and `DELETE /api/videos/cache/:videoId`

Clears the whole cache or a single video entry.

```bash
curl -X DELETE http://localhost:3000/api/videos/cache
curl -X DELETE http://localhost:3000/api/videos/cache/dQw4w9WgXcQ
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port the API listens on. |
| `GEMINI_API_KEY` | no | — | Enables live Gemini analysis (`gemini-1.5-flash`). Without it, the app uses a deterministic offline mock provider labeled `"provider": "mock"`, so builds and tests never need network or keys. |
| `MEALPILOT_CACHE_DIR` | no | `data/cache` | Override for the runtime file-cache directory. |

See `.env.example` for a template. Never commit real keys.

## Gemini + transcription + cache design

- **`GeminiService`** (`src/videos/gemini.service.ts`): if `GEMINI_API_KEY` is set, it prompts `gemini-1.5-flash` for strict-JSON recipe analysis (transcript summary, ingredients, nutrition signals, allergens, restriction tags). On any failure it logs a warning and falls back to the mock provider. Without a key it goes straight to mock.
- **Mock provider**: deterministic, keyword-driven analysis derived from video title/channel (e.g. "vegan" → `vegan, vegetarian, dairy-free` tags; "peanut"/"satay" → `peanuts` allergen). Clearly labeled `"provider": "mock"` in every cached entry so consumers can tell demo data from live Gemini output.
- **`TranscriptCacheService`** (`src/videos/transcript-cache.service.ts`): in-memory map backed by persistent JSON files at `data/cache/<videoId>.json`. Runtime cache files are gitignored; the committed `data/videos.seed.json` provides demo candidates.
- **`VideoAnalysisService`**: cache-first orchestrator — lookup → analyze (Gemini or mock) → persist → return.

## Allergy-safety rules

Allergy handling is the safety-critical path (`src/videos/allergy.util.ts`, `MealPlanService.evaluateAllergySafety`):

1. **Normalization**: allergy strings are lowercased, punctuation-stripped, and expanded with alias groups (e.g. `peanuts` ↔ `peanut`/`groundnut`; `shellfish` ↔ `shrimp`/`crab`/`lobster`/…; `tree nuts` ↔ `almond`/`walnut`/…), plus naive singular/plural variants.
2. **Hard block (`unsafe`)**: any match between the user's allergies and the analyzed ingredients/detected-allergen list — or any mention in the transcript/summary — marks the video `unsafe`. It is **excluded from `recommendations`** and listed under `excluded` with a `Blocked:` reason.
3. **Uncertain**: when the offline mock provider cannot prove the *absence* of a severe allergen (peanut, tree nut, shellfish, fish, sesame, milk, egg, soy), the video is marked `uncertain` and likewise excluded with a `Needs review:` reason.
4. **Never a safety guarantee**: even `safe` results carry notes telling the user to verify the full recipe, and every response includes the medical disclaimer.

## Local development

Requires Node 20+.

```bash
npm install
npm run start:dev   # watch mode, http://localhost:3000/api
npm run build       # compile to dist/
npm start           # run compiled output
npm test            # unit tests (offline, no keys/network)
npm run test:e2e    # end-to-end API tests (offline)
npm run lint        # eslint
```

Swagger UI is served at `http://localhost:3000/api/docs`.

## Deploy on Render

The repo ships a Render Blueprint (`render.yaml`) defining one free Web Service (`meal-pilot`, region Frankfurt, runtime Node 22):

- Build: `npm ci && npm run build` — Start: `npm start` — Health check: `GET /api/health`.
- The port comes from Render's `PORT` env var (see `src/main.ts`); no extra config needed.
- The service landing page `GET /` redirects to the Swagger UI at `/api/docs` — that is the test UI (no frontend).

Steps in the Render dashboard:

1. **New -> Blueprint**, connect/select the `meal-pilot` repo and apply the Blueprint.
2. When prompted for env vars, set `GEMINI_API_KEY` (optional): leave it empty to run on the deterministic offline mock provider (`"provider": "mock"`), or paste a Gemini key for live analysis (`gemini-1.5-flash`).
3. **Deploy**. Open the service URL: `/` lands on Swagger UI; `/api/health` must return `{ "status": "ok" }`.

> Free-plan note: the service sleeps after inactivity, so the first request after idle can take ~30-60s (cold start). The persistent file cache (`data/cache/`) is ephemeral on Render — cached analyses reset on each deploy/restart, which is safe because entries are recomputed on demand.

## Project structure

```text
src/
  main.ts                        # bootstrap, global prefix /api, validation, Swagger
  app.module.ts
  landing/landing.controller.ts  # GET / -> redirect to /api/docs (landing page)
  health/health.controller.ts    # GET /api/health
  meal-plan/
    meal-plan.controller.ts      # POST /api/meal-plan
    meal-plan.service.ts         # ranking, allergy verdicts, explanations
    dto/                         # request/response DTOs + validation
  videos/
    videos.controller.ts         # GET/DELETE /api/videos/cache
    transcript-cache.service.ts  # file + memory cache
    gemini.service.ts            # Gemini live path + offline mock fallback
    video-analysis.service.ts    # cache-first orchestration
    allergy.util.ts              # normalization + matching (safety-critical)
    youtube.util.ts              # video-id extraction
data/
  videos.seed.json               # committed demo candidates
  cache/                         # runtime cache (gitignored)
test/
  app.e2e-spec.ts                # offline API tests
```

## Roadmap

- Real YouTube transcript fetching (caption tracks) instead of reconstructed summaries.
- Per-user history and preference learning.
- Nutrition-API enrichment (per-serving macros/sodium estimates).
- Richer restriction engine (halal/kosher certification flags, FODMAP).
- Human review queue for `uncertain` allergy verdicts.
- Rate limiting, API keys, and request logging for production use.
- Docker image + CI workflow (build/test/lint on every PR).
