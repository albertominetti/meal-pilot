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
   - Built-in tools: `list_known_videos`, `search_videos`, `analyze_video`, `check_profile_fit`, and `submit_plan`.
   - Strict server-side verification: submissions require safe analysis verification before acceptance.
   - Deterministic `FallbackPlanner` if the agent exhausts its step, analysis, or search budgets.
   - Optional `?debug=true` flag returns full multi-turn execution step traces.

2. **Multimodal Recipe Analysis Schema v2**:
   - Multimodal YouTube video analysis via `gemini-3.8-flash`.
   - Structured JSON schema enforcing: recipe name, servings, ingredients (quantity/unit/item), step instructions, allergens with evidence & confidence (`confirmed`, `likely`, `possible`), cross-contact notes, sodium sources, nutrition signals, and restriction tags.
   - If schema validation fails, analyzer retries once with specific schema error feedback. If unavailable or invalid, it returns `status: "unavailable"` fail-safe rather than hallucinating ingredients.

3. **EU 14 Canonical Allergens & Table-Driven Safety**:
   - Standards-compliant canonical allergen mapping following **EU Regulation No 1169/2011** (Gluten, Crustaceans, Eggs, Fish, Peanuts, Soy, Milk, Tree nuts, Celery, Mustard, Sesame, Sulphites, Lupin, Molluscs).
   - Expanded alias dictionary with conservative substring/word-boundary matching.
   - Deterministic table-driven safety evaluation:
     - `unsafe`: Hard block on confirmed/likely allergen matches or direct ingredient matches. Excluded from recommendations.
     - `uncertain`: Potential allergen risk, cross-contact warnings, partial recipe coverage with declared allergies, or offline mock evaluation for severe allergens. Excluded from recommendations.
     - `safe`: Explicitly verified absence of allergens and safe profile fit.

4. **YouTube Discovery & Quota Protection**:
   - YouTube Data API v3 integration with automated query caching (24-hour TTL) and ISO 8601 duration parsing (`PT15M33S`).
   - In-memory quota tracker guarding against exceeding daily Google API quota limits.
   - Graceful fallback to committed seed dataset (`data/videos.seed.json`) when YouTube API is unconfigured or quota is exhausted.

5. **User Privacy**:
   - All Gemini Interactions API calls set **`store: false`** to guarantee that user health profiles and dietary interactions are not retained on Google servers.

6. **Versioned Persistent Cache**:
   - Cache keying includes video ID, provider, model, and schema version (`<videoId>.<provider>.<model>.v2.json`).
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
    "preferences": "sheet pan dinner, under 30 minutes",
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
      "healthNotes": "Low sodium sources, excellent vegetable variety."
    }
  ],
  "excluded": [],
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
Direct pipeline that resolves candidate video metadata, performs parallel multimodal analysis, evaluates allergy safety, and ranks matches.
```bash
curl -X POST http://localhost:3000/api/meal-plan \
  -H 'Content-Type: application/json' \
  -d '{
    "healthProfile": "hypertension, type 2 diabetes",
    "restrictions": ["vegetarian", "gluten-free"],
    "allergies": ["peanuts", "shellfish"],
    "videoCandidates": [
      { "idOrUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Veggie Stir Fry", "channel": "Cooking Channel" }
    ],
    "maxResults": 5
  }'
```

### 4. `GET /api/videos/cache` & `DELETE /api/videos/cache`
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
```

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
