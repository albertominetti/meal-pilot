# MealPilot

MealPilot is an **Agentic NestJS + TypeScript JSON API** that matches **YouTube meal videos** to a user's health profile, dietary restrictions, and allergies.

You provide a free-text health description (e.g. hypertension, diabetes) alongside structured constraints (blood pressure, dietary restrictions, and severe allergies). The API autonomously discovers, analyzes, filters, and ranks recipes from YouTube, providing per-video medical/dietary explanations of *why it fits*.

Powered by the **Google Gen AI SDK (`@google/genai`) Interactions API** with **`gemini-3.8-flash`**, MealPilot uses structured schema extraction, fail-safe table-driven allergy safety guardrails, YouTube Data API discovery with quota enforcement, and a persistent cache.

> **Medical disclaimer (informational only, not medical advice).**
> MealPilot does not provide medical advice, diagnosis, or treatment. Always consult a qualified health professional before changing your diet — especially with hypertension, diabetes, allergies, or other conditions. Allergy information here is best-effort analysis, never a guarantee of safety.

---

## Key Features

1. **Autonomous Agent Loop (`POST /api/meal-plan/agent`)**:
   - Multi-turn planning using the Gemini Interactions API.
   - Built-in tools: `list_known_videos`, `search_videos`, `analyze_video`, `check_profile_fit`, `check_plan_balance`, and `submit_plan`.
   - The agent decides on what is actually in the video: `analyze_video` and `list_known_videos` return a compact digest (≤ 1.5 KB) with key ingredients and quantities, main protein, cuisine, prep time, coverage, `fitsTime`, label checks, the allergy verdict and a ranking score.
   - `check_plan_balance` warns about repeated proteins (max two), repeated recipes, prep time over the limit, partial coverage and uncovered restrictions or goals. It advises; it never rejects.
   - Strict server-side verification: `submit_plan` only accepts analysed, allergy-safe recipes within the cooking-time limit.
   - Deterministic `FallbackPlanner` if the agent exhausts its step, analysis, or search budgets. It uses the same ranking as the pipeline (`src/recipes/ranking.ts`).
   - Optional `?debug=true` flag returns full multi-turn execution step traces.

2. **Multimodal Recipe Analysis Schema v3**:
   - Multimodal YouTube video analysis via `gemini-3.8-flash`. The video description (often holding the written recipe) is fetched with the same `videos.list` call and passed to Gemini as tagged, sanitised, untrusted data (max 5,000 characters).
   - Each ingredient has a normalised `name`, numeric `quantity`, `unit` (g, kg, ml, l, tsp, tbsp, cup, piece, can, clove, pinch, bunch, slice, or null), `rawText`, `confidence`, `source` (`video`, `description`, `both`) and `packaged`.
   - The recipe also has `prepMinutes`, `servings`, `mainProtein`, `cuisine` and `mealType`, plus steps, allergens with evidence and confidence (`confirmed`, `likely`, `possible`), cross-contact notes, sodium sources, nutrition signals (model estimates, marked as such) and restriction tags.
   - Packaged ingredients are returned as `labelCheck` with the note "Check the product label for allergens".
   - If schema validation fails, analyzer retries once with specific schema error feedback. If unavailable or invalid, it returns `status: "unavailable"` fail-safe rather than hallucinating ingredients.

3. **EU 14 Canonical Allergens & Table-Driven Safety**:
   - Standards-compliant canonical allergen mapping following **EU Regulation No 1169/2011** (Gluten, Crustaceans, Eggs, Fish, Peanuts, Soy, Milk, Tree nuts, Celery, Mustard, Sesame, Sulphites, Lupin, Molluscs).
   - Expanded alias dictionary with conservative substring/word-boundary matching.
   - Deterministic table-driven safety evaluation:
     - `unsafe`: Hard block on confirmed/likely allergen matches or direct ingredient matches. Excluded from recommendations.
     - `uncertain`: Potential allergen risk, cross-contact warnings, partial recipe coverage with declared allergies, or offline mock evaluation for severe allergens. Excluded from recommendations.
     - `safe`: Explicitly verified absence of allergens and safe profile fit.
   - The ingredient check searches both the normalised name and the raw text, so an allergen named only in the video description is still caught.

4. **YouTube Discovery & Quota Protection**:
   - YouTube Data API v3 integration with automated query caching (24-hour TTL) and ISO 8601 duration parsing (`PT15M33S`).
   - In-memory quota tracker guarding against exceeding daily Google API quota limits.
   - Graceful fallback to committed seed dataset (`data/videos.seed.json`) when YouTube API is unconfigured or quota is exhausted.

5. **Profile Fit, Ranking and Shopping List**:
   - Optional profile fields: `householdSize` (1–12), `maxCookMinutes` (5–240, a hard filter when prep time is known), `budget` (a search hint only, never a filter) and `healthGoals` (`high-protein`, `low-sodium`, `high-fiber`, `low-carb`, `low-sugar`, `weight-loss`).
   - Every recommendation carries the full extracted `recipe` and server-built `evidence` (the ingredients behind each matched goal and the allergy notes) next to the model's `whyItFits`.
   - Every exclusion has a `code`: `allergen`, `uncertain`, `unavailable` or `too_long`.
   - Team-reviewed channels in `data/trusted-channels.json` are marked `trustedChannel` and listed first in search results, and they get a ranking bonus.
   - Both meal-plan endpoints return a `shoppingList`, merged and scaled to the household and grouped by supermarket section. `POST /api/shopping-list` builds one for any cached recipes.

6. **User Privacy**:
   - All Gemini Interactions API calls set **`store: false`** to guarantee that user health profiles and dietary interactions are not retained on Google servers.

7. **Versioned Persistent Cache**:
   - Cache keying includes video ID, provider, model, and schema version (`<videoId>.<provider>.<model>.v3.json`). Older schema versions are ignored automatically.
   - 30-day TTL expiration. Unavailable or mock results are never persisted in live mode.

---

## Endpoints

Interactive Swagger UI documentation is available at `GET /api/docs`.

### 1. `GET /api/health`
Returns service status, active LLM mode, and configured model.
```bash
curl http://localhost:3000/api/health
```
```json
{
  "status": "ok",
  "service": "meal-pilot",
  "mode": "live",
  "model": "gemini-3.8-flash"
}
```

### 2. `POST /api/meal-plan/agent` (Agentic Autonomous Planner)
Runs an autonomous multi-turn agent that searches for candidates, performs multimodal video analysis, checks profile compatibility, and submits a verified meal plan.
```bash
curl -X POST "http://localhost:3000/api/meal-plan/agent?debug=true" \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, pre-diabetic, seeking high fiber and low sodium",
    "restrictions": ["vegetarian"],
    "allergies": ["peanuts", "sesame"],
    "preferences": "sheet pan dinner",
    "healthGoals": ["high-fiber", "low-sodium"],
    "maxCookMinutes": 30,
    "householdSize": 2,
    "budget": "low",
    "maxResults": 3
  }'
```
Response includes recommendations, exclusions, medical disclaimer, and an optional execution `trace` (when `?debug=true`):
```json
{
  "recommendations": [
    {
      "videoId": "abc123xyz",
      "url": "https://www.youtube.com/watch?v=abc123xyz",
      "title": "Sheet Pan Roasted Vegetables & Tofu",
      "channel": "Healthy Dinners",
      "whyItFits": "Low-sodium, high-fiber, free of declared allergens (peanuts, sesame).",
      "matchedTags": ["vegetarian", "low-sodium", "high-fiber"],
      "allergySafety": {
        "status": "safe",
        "notes": "No match for declared allergies: peanuts, sesame."
      },
      "healthNotes": "Low sodium sources, excellent vegetable variety.",
      "labelCheck": ["vegetable stock"],
      "labelCheckNote": "Check the product label for allergens",
      "trustedChannel": false,
      "fitsTime": true,
      "recipe": {
        "recipeName": "Sheet Pan Tofu",
        "servings": 2,
        "prepMinutes": 25,
        "mainProtein": "tofu",
        "cuisine": "asian",
        "mealType": ["dinner"],
        "coverage": "full",
        "ingredients": [
          { "name": "tofu", "quantity": 400, "unit": "g", "rawText": "400g firm tofu", "confidence": "high", "source": "description", "packaged": false }
        ],
        "steps": ["..."],
        "labelCheck": ["vegetable stock"],
        "estimatedNutritionSignals": ["low-sodium", "high-fiber"]
      },
      "evidence": {
        "goals": [{ "goal": "high-fiber", "ingredients": ["broccoli 300 g", "brown rice 150 g"] }],
        "allergens": "No match for declared allergies: peanuts, sesame.",
        "basis": "model-signals"
      }
    }
  ],
  "excluded": [
    { "videoId": "slow01", "url": "...", "title": "Slow Braised Lentils", "reason": "Too long: Takes about 90 min, over your 30-minute limit.", "code": "too_long" }
  ],
  "shoppingList": { "householdSize": 2, "sections": ["..."], "pantry": ["..."], "warnings": [] },
  "disclaimer": "Informational only, not medical advice. Consult a qualified health professional before changing diet.",
  "trace": [
    { "stepNumber": 1, "thought": "I need to find vegetarian recipes suitable for hypertension...", "tool": "search_videos" },
    { "stepNumber": 2, "thought": "Analyzing video abc123xyz...", "tool": "analyze_video" },
    { "stepNumber": 3, "thought": "Checking fit against profile and allergies...", "tool": "check_profile_fit" },
    { "stepNumber": 4, "thought": "Submitting the verified safe plan...", "tool": "submit_plan" }
  ]
}
```

### 3. `POST /api/meal-plan` (Pipeline Planner)
Direct pipeline over the seed list (`data/videos.seed.json`): it analyses every candidate (cached analyses are free), removes unsafe or too-long recipes, and ranks the rest with the same scoring as the agent's fallback. It accepts the same profile fields and returns the same recommendation, exclusion and shopping-list shapes.
```bash
curl -X POST http://localhost:3000/api/meal-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, type 2 diabetes",
    "restrictions": ["vegetarian", "gluten-free"],
    "allergies": ["peanuts", "shellfish"],
    "minResults": 1,
    "maxResults": 5
  }'
```

### 4. `POST /api/shopping-list`
Builds a merged shopping list for recipes that are already analysed. It reads the cache only and never calls Gemini.
```bash
curl -X POST http://localhost:3000/api/shopping-list \
  -H 'Content-Type: application/json' \
  -d '{ "items": [{ "videoId": "veg-low-sodium-01" }, { "videoId": "vegan-quinoa-02", "servings": 1 }], "householdSize": 2 }'
```
```json
{
  "householdSize": 2,
  "sections": [
    { "section": "dry goods & grains", "items": [
      { "name": "brown lentil", "amount": 100, "unit": "g", "exactAmount": 100, "uncertain": false, "fromRecipes": ["veg-low-sodium-01"] }
    ] }
  ],
  "pantry": [{ "name": "olive oil", "amount": 10, "unit": "ml", "exactAmount": 7.5, "uncertain": false, "fromRecipes": ["veg-low-sodium-01"] }],
  "warnings": []
}
```
- Amounts scale by `householdSize / recipe servings` (or a per-item `servings`). When the recipe's servings are unknown, it uses one batch and adds a warning.
- Names are merged (`garbanzo` → `chickpea`), units converted to g, ml or counts, and amounts rounded to buying units (380 g → 400 g, 1.3 cans → 2), with the exact amount alongside.
- Unclear amounts (low confidence, missing quantity, a pinch) show `"amount unclear: check recipe"`. They are never invented.

### 5. `GET /api/videos/cache` & `DELETE /api/videos/cache`
Inspect or manage persisted video analysis cache entries:
```bash
# List cached videos
curl http://localhost:3000/api/videos/cache

# Delete specific video cache entry
curl -X DELETE http://localhost:3000/api/videos/cache/dQw4w9WgXcQ

# Clear entire cache
curl -X DELETE http://localhost:3000/api/videos/cache
```

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `3000` | HTTP port the API listens on. |
| `NODE_ENV` | string | `development` | Environment (`development`, `production`, `test`). |
| `GEMINI_API_KEY` | string | — | Google Gemini API key. Required when `MEALPILOT_LLM_MODE=live`. |
| `MEALPILOT_LLM_MODE` | enum | `auto` | `live`, `mock`, or `auto`. In `auto`, uses `live` if `GEMINI_API_KEY` is present, else `mock`. In `test` environment, defaults to `mock`. |
| `GEMINI_MODEL` | string | `gemini-3.8-flash` | Gemini model slug for multimodal analysis and agent loop. |
| `YOUTUBE_API_KEY` | string | — | YouTube Data API v3 key for live video searches and details. If omitted, uses offline mock candidate dataset. |
| `YOUTUBE_DAILY_QUOTA_CAP` | number | `9000` | Quota unit ceiling per day (Google default quota is 10,000 units). |
| `ANALYSIS_CONCURRENCY` | number | `3` | Maximum number of concurrent video analyses in batch requests. |
| `MEALPILOT_CACHE_DIR` | string | `data/cache` | Directory path for persistent JSON video analysis cache files. |
| `MEALPILOT_CACHE_TTL_DAYS` | number | `30` | Cache retention TTL in days. |
| `TRUSTED_CHANNELS_FILE` | string | `data/trusted-channels.json` | JSON list of `{ channelId, name, note }` for team-reviewed channels. |

See `.env.example` for a copyable starter file.

---

## Local Development & Testing

Requires **Node.js 20+**.

```bash
# Install dependencies
npm install

# Start in watch mode
npm run start:dev

# Run unit tests (100% offline, zero keys needed)
npm test

# Run e2e tests
npm run test:e2e

# Lint and check formatting
npm run lint

# Compile production build
npm run build

# Analysis eval: allergen recall (gate) and ingredient unit / quantity ±20% accuracy
npm run eval:analysis
```

### Analysis eval

`npm run eval:analysis` analyses every video in `eval/videos.labeled.json` and reports:
- **allergen recall**, measured on the deterministic safety check. This is the gate: any missed labelled allergen fails the run.
- the share of matched ingredients with the **correct unit**, and with a **quantity within ±20%**.

With `GEMINI_API_KEY` set it calls Gemini (live, not in CI). `eval/videos.labeled.json` must hold 10 or more real videos, hand-labelled with their allergens and ingredient quantities, in the format of `eval/videos.labeled.example.json`. Until that file exists, the runner falls back to the example set, which uses the offline fixture videos and is not a real measurement.

---

## Architecture

```text
src/
  config/                  # Typed AppConfigService with Zod validation and fast-boot checks
  llm/                     # LlmClient interface, GenAiLlmClient (Interactions API), MockLlmClient
  youtube/                 # YouTube Data API client, quota tracker, 24h search cache
  videos/
    analyzers/             # Analysis Schema v2, GeminiVideoAnalyzer, MockVideoAnalyzer
    transcript-cache.service.ts # Versioned disk cache with TTL
    video-analysis.service.ts   # Cache-first analysis orchestrator
    allergy.util.ts        # EU-14 canonical allergens & conservative alias matching
    youtube.util.ts        # Video ID parser
  meal-plan/               # Table-driven safety evaluation & explanation generation
  agent/                   # Autonomous agent loop, tools, prompt, fallback planner, controller
  health/                  # GET /api/health with mode/model reporting
  landing/                 # GET / redirect to Swagger UI (/api/docs)
```

---

## Deployment on Render

A `render.yaml` blueprint is included:
- **Service**: Web Service (Node 22 runtime, region Frankfurt).
- **Build**: `npm ci && npm run build`
- **Start**: `npm start`
- **Health Check**: `GET /api/health`
- **Environment**: Add `GEMINI_API_KEY` and optionally `YOUTUBE_API_KEY` in the Render environment variables dashboard.
