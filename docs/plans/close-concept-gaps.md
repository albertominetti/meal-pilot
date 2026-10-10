# Plan: Close the gaps between the MealPilot concept and the implementation

Status: Phases 1–4 implemented; Phases 5–7 open · Author: Fabian (drafted with Claude) · Date: 2026-10-10
Builds on: [agentic-gemini.md](agentic-gemini.md) (Phases 1–4 are implemented)

> **Implementation notes (2026-10-10).** Phases 1–4 are implemented. Phase 3 landed before Phase 2 because Phase 2's `fitsTime` and the `submit_plan` time test need `maxCookMinutes`. Still open:
> - `eval/videos.labeled.json` needs 10 hand-labelled real videos. The runner and the example set on offline fixtures exist.
> - `data/trusted-channels.json` ships empty until the team adds reviewed channels.
> - The deterministic `/api/meal-plan` now analyses every seed candidate before ranking. That is cheap with the cache, but every new seed video costs one Gemini call.

## 0. Scope

**In scope:** everything from the concept except the 7-day planner.

**Out of scope for now:**
- assigning recipes to days
- balancing nutrients across the week
- reusing ingredients across days ("half a bag of spinach Monday, the rest Wednesday")
- the Sunday-evening weekly job, which only makes sense once a weekly plan exists
- the app UI, which lives in the JJFit repo (this plan only defines the API it needs)

Until the 7-day planner exists, a "plan" here means the list of recommendations returned today, with `maxResults` set to the number of meals wanted. Every item below is built so that a later day-assignment step can sit on top without rework.

| Gap | Today | Phase |
|---|---|---|
| Ingredient quantities | Free-text `quantity`, no unit, no confidence | 1 |
| Video description | Never fetched; only title and channel go into the prompt | 1 |
| Prep time | Not extracted | 1 |
| Product label warning | Generic disclaimer only | 1 |
| **Extracted content in the agent** | Agent sees tags and a summary only. Ingredients, steps, coverage and evidence are dropped. The response has no recipe | 2 |
| Profile: household size, cooking time, budget, goals | Missing | 3 |
| Trusted channels | No preference | 3 |
| Shopping list | Missing | 4 |
| Nutrients from a food database | Gemini guesses labels | 5 |
| Persistent storage | JSON files on Render's ephemeral disk | 6 (Neon Postgres) |
| Profiles, meal log, feedback | Missing | 7 |
| Swap one meal and update the shopping list | Missing | 7 |

## 1. Key decisions (please confirm)

1. **Database: Neon (serverless Postgres)** via `DATABASE_URL`, with **Drizzle ORM** (typed, small, SQL migrations). When `DATABASE_URL` is empty, keep the file cache so tests and local mock runs need no database. Neon over Render Postgres because:
   - the free tier doesn't expire
   - it scales to zero when idle
   - it has database branching for previews and tests
   - it offers an EU region next to our Render service in Frankfurt

   See Phase 6.
2. **Nutrients: USDA FoodData Central (FDC)** with a free `FDC_API_KEY`. Nutrients are calculated in code. Gemini keeps extracting ingredients only and stops producing nutrition labels.
3. **Identity: the JJFit app owns users.** The backend stores profiles and logs under an opaque `userId` sent by the app. App and backend authenticate with a shared API key (`MEALPILOT_APP_KEY`). There is no login in this service.
4. **Budget is a soft hint.** We have no price data, so budget only steers the agent's search ("budget", "cheap"). It is never a filter. Real prices need a supermarket data source, which is out of scope.
5. **Cooking time is a hard filter when known.** If `prepMinutes > maxCookMinutes`, the recipe is excluded. If the time is unknown, the recipe is allowed with a note.

## 2. Phases (one PR per phase)

### Phase 1: Extraction schema v3 and video description (≈1–1.5 days)

**1.1 Schema** (`ANALYSIS_SCHEMA_VERSION = 3`; old cache entries stop matching automatically):
```ts
ingredients: {
  name: string;               // normalised, singular: "chickpea"
  quantity: number | null;    // 400
  unit: Unit | null;          // enum: g, kg, ml, l, tsp, tbsp, cup, piece, can, clove, pinch, bunch, slice
  rawText: string;            // as said/shown: "a big splash of olive oil"
  confidence: 'high' | 'medium' | 'low';
  source: 'video' | 'description' | 'both';
  packaged: boolean;          // store-bought product (sauce, stock, pesto, curry paste)
  timestamp?: string;
}[]
prepMinutes?: number;         // total active + passive time to make the dish
servings?: number;            // already exists
mainProtein?: string;         // enum: chickpea, lentil, bean, tofu, tempeh, egg, dairy, chicken, beef, pork, fish, seafood, none, other
cuisine?: string;             // free short text: "indian", "italian"
mealType: ('breakfast' | 'lunch' | 'dinner' | 'snack')[];
```
- Remove `nutritionSignals` from what Gemini outputs. Phase 5 computes them. Until Phase 5 lands, keep the field but mark it `source: 'model'` so it isn't shown as fact.
- `restrictionTags`, allergens, `crossContactNotes`, `sodiumSources` and `coverage` stay as they are.

**1.2 Video description**
- Add `description` and `channelId` to `YouTubeVideoDetails`. Both come from `snippet`, which `videos.list` already requests, so there is no extra quota cost.
- Extend `VideoTarget` with `description?`. `analyze_video` and the deterministic pipeline call `getDetails` (1 unit) when they don't have the description yet.
- The analyzer prompt adds the description as clearly marked untrusted data, truncated to about 5,000 characters. Instruction: prefer exact quantities from the description, set `source`, and report conflicts between video and description with `confidence: 'medium'`.

**1.3 Product label notes.** For every ingredient with `packaged: true`, the response carries `labelCheck: ["curry paste", "vegetable stock"]` with the note "Check the product label for allergens". This matches the concept's wording rule: informational, not medical.

**1.4 Allergy check.** The haystack now includes `rawText` as well as `name`, so it stays at least as conservative as today. Add tests for a peanut sauce listed only in the description and for a `packaged` ingredient.

**1.5 Mock analyzer and seed.** Update `MockVideoAnalyzer`, `data/videos.seed.json` and the fixtures to v3.

**1.6 Eval.** Extend the labelled eval set (agentic-gemini §2.7) with quantities for 10 videos. Report the share of ingredients with the correct unit and with quantity within ±20%. Allergen recall stays the gate.

**Done when:** a real video with a recipe in its description returns numeric quantities with `source: 'description'`, and all existing allergy tests still pass.

### Phase 2: Use the extracted video content in the agent algorithm (≈1.5 days)

Gemini watches the video and extracts its content, but today the agent only sees a few tags. This phase makes the agent's decisions, and the app's display, depend on what is actually in the video.

**2.1 Content digest for the agent.** `analyze_video` and `list_known_videos` return a compact digest built server-side from the analysis:
```ts
{
  videoId, title, channel, trustedChannel,
  recipeName, mainProtein, cuisine, mealType, prepMinutes, servings,
  coverage,                                   // the agent should prefer 'full'
  keyIngredients: string[],                   // top 10 by quantity, e.g. "chickpea 400 g"
  lowConfidenceIngredients: string[],         // "olive oil (a splash)"
  restrictionTags, labelCheck,
  nutrientsPerServing?,                       // from Phase 5, with completeness
  allergySafety: { status, notes },
  fitsTime: boolean | null                    // against maxCookMinutes (Phase 3)
}
```
- Cap the digest at about 1.5 KB per video and 10 videos per `list_known_videos` call to protect the context window. The full analysis stays in `AgentRun`.
- All digest strings come from the video or description, so they are untrusted. Keep them in tool results (never in the system prompt), strip control characters, and cap each field's length.

**2.2 New deterministic tool: `check_plan_balance`**
- Args: `videoIds[]`.
- Returns:
  - the distribution of `mainProtein` and `cuisine`
  - repeated recipes
  - total and maximum prep time against the profile
  - the number of shared ingredients (useful later for waste reduction)
  - restrictions or goals that no selected recipe covers
  - nutrient totals per serving once Phase 5 lands
- The agent calls it before `submit_plan`. It is advice, not a gate: it returns warnings and never rejects.

**2.3 Ranking with content**
- `fallback-planner.ts` and the deterministic `/api/meal-plan` score each candidate with a code formula:
  - restriction and goal match
  - `coverage: full`
  - trusted channel
  - share of `high`-confidence ingredients
  - fit with cooking time
  - a penalty for a `mainProtein` that is already selected
- The weights live in one function with unit tests, so the agent's prompt and the fallback agree on what "good" means.
- The prompt changes from "aim for variety" to "use the digest and `check_plan_balance`: no more than two recipes with the same `mainProtein`, prefer full coverage, respect `fitsTime`".

**2.4 Evidence-based explanations**
- `submit_plan` stays the gate for safety.
- The server attaches `evidence` to each accepted recommendation:
  - the ingredients behind each matched goal (e.g. `high-protein: chickpea 400 g, tofu 200 g`)
  - the allergen-evidence notes
- `whyItFits` stays the model's text, and the app shows `evidence` next to it.

**2.5 Recipe in the response.** `RecommendationDto` gets a `recipe` object with ingredients (all v3 fields), steps, servings, prepMinutes, coverage, labelCheck and (later) nutrients. The app can then show the recipe without calling Gemini itself. Apply this to both endpoints.

**2.6 Tests.** Add ScriptedLlmClient scenarios:
1. The agent gets a digest showing two chickpea dishes, calls `check_plan_balance`, and swaps one.
2. `fitsTime: false` stops the recipe from being submitted, because the time filter is also enforced in `submit_plan` (see 3.3).

Unit tests: digest size cap, ranking weights, evidence builder.

**Done when:** a live agent run's trace shows decisions based on ingredients, protein and prep time, and the response contains the full recipe for each recommendation.

### Phase 3: Profile fields and trusted channels (≈1 day)

**3.1 Request DTO additions** (all optional; existing clients keep working):
```ts
householdSize?: number;        // 1–12, default 1
maxCookMinutes?: number;       // 5–240
budget?: 'low' | 'medium' | 'high';
healthGoals?: HealthGoal[];    // enum: high-protein, low-sodium, high-fiber, low-carb, low-sugar, weight-loss
```
- `restrictions` and `allergies` stay. `healthGoals` moves goals out of free text so code can match them. `healthProfile` and `bloodPressure` stay as context for the agent.

**3.2 Agent prompt.** Include the new fields. Search queries should include the time limit ("under 30 minutes") and budget wording when set.

**3.3 Enforcement**
- `submit_plan` and the deterministic pipeline exclude a recipe when `prepMinutes > maxCookMinutes`, with reason `too_long`.
- Goals are matched like restrictions. Before Phase 5 this uses model signals; after it, computed nutrients.

**3.4 Trusted channels**
- `data/trusted-channels.json`: a list of `{ channelId, name, note }`, reviewed by the team.
- `search_videos` marks results with `trustedChannel: true` and sorts trusted ones first.
- The ranking in 2.3 adds a bonus.
- No channel-scoped searches for now: each costs 100 quota units.

### Phase 4: Shopping list (≈1.5–2 days, depends on Phase 1)

**4.1 Endpoint and response**
- `POST /api/shopping-list` with `{ items: [{ videoId, servings? }], householdSize }`. It reads analyses from the cache and never calls Gemini.
- The meal-plan responses also include `shoppingList` for the returned recommendations.

**4.2 Algorithm** (`src/shopping/`, pure functions, table-driven tests)
1. **Scale:** factor = `householdSize / recipe.servings`. If `servings` is unknown, use the factor 1 and flag it.
2. **Normalise names:**
   - lowercase and singular
   - a small alias map ("garbanzo" → "chickpea", "scallion" → "spring onion")
   - descriptors like "fresh" or "chopped" are removed, while words like "smoked" that change the product are kept
3. **Convert units** to a base unit per ingredient:
   - mass → g, volume → ml
   - `tsp`/`tbsp`/`cup` → ml
   - `can`, `clove`, `piece` stay as counts
   - convert between mass and volume only for a small density table (water, milk, oil, flour, sugar, rice). Otherwise keep separate lines rather than guess.
4. **Merge** lines with the same normalised name and base unit, and keep links back to the source recipes.
5. **Round to buying units:** 380 g → "400 g", 1.3 cans → "2 cans". Keep the exact amount next to it.
6. **Group by supermarket section** with a static map (produce, dairy & eggs, meat & fish, bakery, dry goods & grains, canned & jars, spices & condiments, frozen, other). Unknown ingredients go to "other".
7. **Pantry staples** (salt, pepper, oil, water, common spices) go to a collapsible "you probably have this" group.
8. **Uncertain amounts:** `low` confidence, missing quantity, or `pinch`/"to taste" are shown as "amount unclear: check recipe". They are never invented.

**4.3 Response shape**
```ts
shoppingList: {
  householdSize,
  sections: [{ section, items: [{ name, amount, unit, exactAmount, uncertain, fromRecipes: videoId[] }] }],
  pantry: [...],
  warnings: string[]          // "servings unknown for X", "could not merge 2 cloves + 10 g garlic"
}
```
The app keeps checkbox state locally. Server-side checkbox state comes with saved plans in Phase 7.

### Phase 5: Nutrients from USDA FoodData Central (≈2–3 days, depends on Phase 1)

**5.1 `NutritionService`** (`src/nutrition/`)
- **Ingredient to FDC food:** search FDC (Foundation and SR Legacy data types first) for the normalised name and take the top hit.
- **Cache mappings permanently**, in the file cache at first and in the `fdc_mappings` table from Phase 6. The same mapping is reused across all videos.
- **Manual overrides** for common mismatches go in `data/fdc-overrides.json` (e.g. "coconut milk" must map to the canned product, not the beverage).
- **Grams per ingredient:**
  - mass units directly
  - volume through the density table from 4.2
  - counts through FDC `foodPortions` ("1 clove", "1 medium")
  - otherwise unresolved
- **Sum and divide by `servings`.** Output: kcal, protein, fat, saturated fat, carbs, sugar, fiber, sodium.

**5.2 Honesty fields**
- `completeness`: the share of total recipe mass that was resolved. Low-confidence ingredients count as unresolved.
- `estimated: true` and `source: "USDA FoodData Central"`.
- Below 0.7 completeness, the app shows "partial estimate" and goals are not matched from nutrients.

**5.3 Derived signals.** `high-protein`, `low-sodium` and similar labels come from fixed thresholds per serving (documented in code, e.g. low-sodium ≤ 600 mg per meal). They replace the model's labels. Sodium sources stay as an explanation.

**5.4 When it runs**
- Right after video analysis, and stored with it. Bump the stored record version when the mapping logic changes.
- FDC limit: 1,000 requests per hour per key. The mapping cache keeps real usage far below that.
- If FDC is down, the analysis is still returned, with `nutrients: null`.

**5.5 Tests and eval.** Recorded FDC responses as fixtures. Five hand-checked recipes must land within ±15% kcal and protein.

### Phase 6: Persistent storage on Neon Postgres (≈2 days)

**6.0 Neon setup** (one-off, done by the operator in the Neon console)
- **Project:** `meal-pilot`, region **AWS eu-central-1 (Frankfurt)**, the same region as the Render service (`region: frankfurt`). This keeps latency low and the data in the EU.
- **Branches:**
  - `main`: production
  - `dev`: shared development
  - an optional short-lived branch per PR, made by CI (see 6.4)
  Branches are copy-on-write, so creating one is instant and cheap.
- **Roles:** an app role `mealpilot_app` with read/write access to our schema only, and a separate owner role used only for migrations.
- **Connection strings:**
  - **Pooled** (`…-pooler…` host, PgBouncer in transaction mode) → `DATABASE_URL`, used by the app.
  - **Direct** (no `-pooler`) → `DATABASE_URL_DIRECT`, used only by `drizzle-kit` migrations. Migrations and session-level features don't work through transaction pooling.
  - Both with `sslmode=require`.
- **Free-tier behaviour to plan for:**
  - compute scales to zero after a few idle minutes, and the first query after that pays a cold start (typically well under a second)
  - storage and compute hours are capped
  - check the current limits on Neon's pricing page before launch, and move to a paid plan before real users arrive
- **Privacy:** health profiles are GDPR special-category data (Phase 7). Sign Neon's DPA, and document Neon as a sub-processor in the privacy note next to Google Gemini.

**6.1 Driver and connection handling**
- Render runs a long-lived Node process, so use plain **`pg` (node-postgres) with `drizzle-orm/node-postgres`** against the pooled URL.
- `@neondatabase/serverless` (HTTP/WebSocket driver) is meant for serverless and edge runtimes, and we don't need it.
- Pool settings:
  - `max: 5` (PgBouncer does the real pooling)
  - `idleTimeoutMillis: 30000`
  - `connectionTimeoutMillis: 10000`, which covers a cold start
- Retry once on connection errors during wake-up.
- `GET /api/health` reports `db: up | down | disabled` with a `SELECT 1`. Render's health check doesn't fail on a slow first query, because the health endpoint uses a short timeout and reports `degraded` instead of erroring.
- Keep queries to transaction-safe features (no session `SET`, `LISTEN/NOTIFY` or session-level advisory locks) because of transaction pooling.

**6.2 Tables** (Drizzle schema in `src/db/schema.ts`, SQL migrations in `drizzle/`)
- `video_analyses (video_id, provider, model, schema_version, data jsonb, analyzed_at)`, primary key on the first four columns
- `fdc_mappings (normalised_name, fdc_id, description, data_type, portions jsonb, updated_at)`
- `youtube_search_cache (query_norm, video_ids, cached_at)`

- Phase 7 adds `profiles`, `plans` and `meal_logs` in its own migration.
- Index `video_analyses (video_id)` for lookups and `(analyzed_at)` for TTL cleanup.
- TTL cleanup becomes a `DELETE … WHERE analyzed_at < now() - interval '30 days'` run at startup and once a day. It runs inside the app, so no extra cron service is needed.

**6.3 Async cache interface**
- Change `TranscriptCacheService` to an async `AnalysisStore` interface with two implementations: `PgAnalysisStore` and `FileAnalysisStore` (today's code).
- Call sites to update:
  - [video-analysis.service.ts:28](../../src/videos/video-analysis.service.ts)
  - [list-known-videos.tool.ts:41](../../src/agent/tools/list-known-videos.tool.ts)
  - [videos.controller.ts:12](../../src/videos/videos.controller.ts)
- **Shared cache:** analyses become shared across users and survive deploys. This is the concept's "popular recipes are reused" point.

- **Seeding the cache:** a one-off script `npm run db:import-cache` loads the existing `data/cache/*.json` (current schema version only) into `video_analyses`.

**6.4 Migrations, environments and CI**
- **Scripts:**
  - `npm run db:generate` (`drizzle-kit generate`, creates SQL from the schema; review the SQL in the PR)
  - `npm run db:migrate` (`drizzle-kit migrate`, uses `DATABASE_URL_DIRECT`)
- **Deploys:** Render runs `npm run db:migrate` as a pre-deploy command, so a failed migration stops the deploy. The pre-deploy command isn't available on Render's free web plan. Until then, run migrations at app startup behind a Postgres advisory lock, through the direct URL, since session locks don't work through the pooler.
- **Local development:**
  - developers use the Neon `dev` branch, or their own branch
  - `docker compose up postgres` is the offline option
  - `.env.example` gets `DATABASE_URL` and `DATABASE_URL_DIRECT` with placeholder values
- **Tests:**
  - unit tests and the offline e2e suite keep using `FileAnalysisStore` with no database
  - a new `test/db` suite runs the store against a real Postgres
  - in GitHub Actions, the official Neon actions create a branch per run from `main` (`neondatabase/create-branch-action`) and delete it afterwards
  - this needs `NEON_API_KEY` and `NEON_PROJECT_ID` as repository secrets
- **Backups:** Neon's point-in-time restore covers us for now (the window depends on the plan). Before launch, add a weekly `pg_dump` of `profiles`, `plans` and `meal_logs`.

**6.5 Config and ops**
- `app-config.ts`: add `DATABASE_URL` and `DATABASE_URL_DIRECT` (optional; empty means file store) plus `FDC_API_KEY` and `MEALPILOT_APP_KEY`.
- In `live` mode with `NODE_ENV=production`, fail at boot if `DATABASE_URL` is missing, so production never silently falls back to the ephemeral disk.
- `render.yaml`: add `DATABASE_URL`, `DATABASE_URL_DIRECT`, `FDC_API_KEY` and `MEALPILOT_APP_KEY`, all with `sync: false`. Render doesn't create the database, because it lives in Neon.
- New dependencies: `drizzle-orm`, `pg`; dev dependencies: `drizzle-kit`, `@types/pg`.
- Logging: log query timings and pool errors. Never log connection strings or profile data.

**Done when:** after a redeploy on Render, `GET /api/videos/cache` still lists earlier analyses, `/api/health` shows `db: up`, and the CI database suite passes against a temporary Neon branch.

### Phase 7: Profiles, meal log, saved plans, meal swap (≈3 days, depends on Phases 4 and 6)

**7.1 Profiles**
- `PUT/GET/DELETE /api/users/:userId/profile`, with the same fields as the request DTO.
- `POST /api/meal-plan*` accepts `userId` in place of a full profile, and an inline profile still overrides it.
- **Health data is special-category data under GDPR Art. 9.** The app must collect explicit consent. `DELETE` removes the profile, logs and plans. Never log profile contents.

**7.2 Saved plans**
- Every meal-plan response is stored as `plans (id, user_id, created_at, items jsonb, shopping_list jsonb, checked jsonb)` and returns `planId`.
- `PATCH /api/plans/:id/checked` stores checkbox state.

**7.3 Meal log and feedback**
- `POST /api/users/:userId/meals` with `{ videoId, planId?, cooked: boolean, rating?: 1–5, note? }`.
- **Feedback into the agent:**
  - `list_known_videos` marks `userRating` and `cookedCount` in the digest (Phase 2)
  - the prompt says to avoid recipes rated ≤ 2 and to bring back well-rated ones now and then
  - the ranking in 2.3 adds a rating term
  - recipes the user rated 1 are excluded in code

**7.4 Swap one meal**
- `POST /api/plans/:id/swap` with `{ videoId }`.
- **Cheap path:** take the best-ranked safe candidate from the shared cache that matches the profile, isn't already in the plan, and keeps `check_plan_balance` within limits. No Gemini call.
- **Fallback:** a short single-slot agent run (budget: 1 search, 2 analyses).
- **Shopping list:** the server recomputes it, carries over checked items that are still in the list, and returns the new plan version.
- This is the concept's open question. It's planned last because it needs saved plans and the shopping list.

## 3. Suggested PR sequence

| PR | Scope | Depends on | Size |
|---|---|---|---|
| 1 | Schema v3, description input, prep time, label notes, eval update | — | M |
| 2 | Content digest, `check_plan_balance`, content ranking, evidence, recipe in response | 1 | M |
| 3 | Profile fields, time filter, trusted channels | 1 (time), — (rest) | S |
| 4 | Shopping list | 1 | M |
| 5 | USDA nutrients, derived signals | 1 | M–L |
| 6 | Neon Postgres (project, branches, Drizzle, async store, migrations, CI branches) | — (can run parallel to 1–5) | M |
| 7 | Profiles, saved plans, meal log, swap | 4, 6 | L |

PRs 1 and 2 give the biggest quality gain: the agent starts using what Gemini sees in the video, and the app gets real recipes. PR 6 can start any time and should land before real users arrive.

## 4. Open questions

1. Does the JJFit app own user identity (decision 3), or does this service need its own auth?
2. Who maintains `trusted-channels.json` and `fdc-overrides.json`?
3. Locale: shopping-list units and sections are metric and Central-European by default. Do we need US units?
4. Neon plan before launch: is the free tier enough for the pilot, and who owns the Neon account and the DPA? Is Render's paid plan (needed for the pre-deploy migration step) acceptable?
5. Should a swap use only cached recipes (fast, free) or always allow a fresh search?

## 5. Later (not in this plan)

- **7-day planner:**
  - assign recipes to days
  - balance nutrients per day and week (Phase 5 totals)
  - reuse ingredients across days (Phase 4 merge data and the `check_plan_balance` shared-ingredient count)
- **Weekly scheduled generation** from saved profiles, using the meal log.
- **Price data** for real budget handling.
