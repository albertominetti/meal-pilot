# MealPilot features

What the service does today, and where each part lives in the code. For request and response examples, see the [README](../README.md#endpoints). Swagger UI at `/api/docs` is the full API reference.

MealPilot is a NestJS JSON API. A client (the JJFit app) sends a health profile, and MealPilot returns YouTube recipe videos that fit it. Each video comes with the extracted recipe, an allergy verdict, evidence, and a shopping list.

## Map

| Area | What it does | Code |
|---|---|---|
| Video analysis | Gemini watches the video and reads its description, then returns structured recipe data (schema v3) | `src/videos/analyzers/` |
| Allergy safety | Deterministic EU-14 allergen check; the model never decides safety | `src/videos/allergy.util.ts`, `MealPlanService.evaluateAllergySafety` |
| Discovery | YouTube search and video details, with quota protection | `src/youtube/` |
| Agent planner | Gemini tool loop that searches, analyses and submits a plan | `src/agent/` |
| Pipeline planner | Deterministic plan over the seed list | `src/meal-plan/meal-plan.service.ts` |
| Profile fit | Cooking-time filter, health-goal matching | `src/meal-plan/profile-fit.ts` |
| Recipe logic | Digest, ranking, plan balance, evidence, units | `src/recipes/` |
| Shopping list | Scale, merge, round, group by section | `src/shopping/` |
| Nutrients | USDA FoodData Central matching, grams, per-serving totals, labels | `src/nutrition/` |
| Storage | Postgres (Neon) when `DATABASE_URL` is set, JSON files otherwise | `src/db/`, `*.store.ts` |
| Profiles and meal log | Stored profiles with consent, ratings that steer planning, erasure | `src/users/` |
| Saved plans | Every plan gets a `planId`; checkbox state; swap one meal | `src/plans/` |

## Video analysis (schema v3)

`VideoAnalysisService.analyzeWithMeta(target)` returns a cached analysis when one exists. On a cache miss, it:
1. fetches the video's details (title, channel, channel ID, description) when the caller has no description; this costs one YouTube quota unit
2. calls the analyzer
3. caches the result if it is `ok`

The Gemini analyzer (`gemini-video-analyzer.ts`) sends the video URL plus a prompt. The description goes inside `<video_description>` tags, marked as untrusted data, with control characters stripped and a 5,000-character cap. The output is validated with Zod (`analysis.schema.ts`). If validation fails, the analyzer retries once with the error message; a second failure gives `status: "unavailable"`.

Each ingredient has:

| Field | Meaning |
|---|---|
| `name` | Normalised, singular: `chickpea` |
| `quantity` | Number, or `null` when not stated |
| `unit` | One of g, kg, ml, l, tsp, tbsp, cup, piece, can, clove, pinch, bunch, slice, or `null` |
| `rawText` | As said or shown: "a big splash of olive oil" |
| `confidence` | `high`, `medium` or `low` (`medium` when video and description disagree) |
| `source` | `video`, `description` or `both` |
| `packaged` | Store-bought product (sauce, stock, paste) |

The recipe also has `prepMinutes`, `servings`, `mainProtein`, `cuisine`, `mealType`, steps, allergens with evidence, cross-contact notes, sodium sources, restriction tags and coverage (`full` or `partial`).

Two fields are derived by the server:
- `labelCheck`: the names of packaged ingredients. Responses add the note "Check the product label for allergens".
- `nutritionSignalsSource: 'model'`: nutrition signals are Gemini estimates, and responses label them as estimates.

Without a Gemini key, `MockVideoAnalyzer` builds the analysis from keywords. It also parses ingredient lists in descriptions, so offline runs exercise the description path.

## Allergy safety

See [safety-and-privacy.md](safety-and-privacy.md). In short: user allergies map to the EU-14 allergens plus aliases, and a fixed rule table decides `safe`, `uncertain` or `unsafe`. Only `safe` recipes are ever recommended.

## Profile fields

All optional, on both meal-plan endpoints:

| Field | Effect |
|---|---|
| `restrictions` | Matched against restriction tags (`vegan` also counts as `vegetarian` and `dairy-free`) |
| `allergies` | Safety-critical; see above |
| `healthGoals` | `high-protein`, `low-sodium`, `high-fiber`, `low-carb`, `low-sugar`, `weight-loss`. Matched on model signals; `low-sugar` and `weight-loss` cannot be verified yet |
| `maxCookMinutes` | **Hard filter** when prep time is known (exclusion code `too_long`). Unknown prep time is allowed with a note |
| `householdSize` | Scales the shopping list |
| `budget` | Steers search wording only. There is no price data, so it never filters |
| `healthProfile`, `bloodPressure`, `preferences` | Free-text context for the agent and the explanations |

## Agent planner: `POST /api/meal-plan/agent`

`AgentService.run` is a Gemini tool loop with budgets for steps, searches, analyses and time (`AGENT_*` env vars). The tools:

| Tool | Purpose |
|---|---|
| `list_known_videos` | Cached analyses as digests, best-ranked first, max 10. Free |
| `search_videos` | YouTube search (100 quota units). Trusted channels first |
| `analyze_video` | Analyse a video and return its digest. Uses the analysis budget |
| `check_profile_fit` | Restriction, goal and time fit for one video |
| `check_plan_balance` | Advice on a draft plan: protein and cuisine spread, repeats, prep time, shared ingredients, gaps. Never rejects |
| `submit_plan` | The gate: accepts only analysed, allergy-safe videos within the time limit |

A **digest** is a compact view of an analysis, capped at about 1.5 KB. It holds key ingredients with quantities, unclear amounts, main protein, cuisine, prep time, coverage, `fitsTime`, label checks, the allergy verdict and a ranking score. Full analyses stay in the run.

If the loop ends without an accepted plan, `FallbackPlanner` picks from the safe analyses using the shared ranking. `?debug=true` adds the tool trace to the response.

## Pipeline planner: `POST /api/meal-plan`

`MealPlanService.buildPlan`:
1. analyses every video in `data/videos.seed.json` (cached analyses cost nothing)
2. excludes unavailable, unsafe, uncertain and too-long recipes
3. ranks the rest with the same scoring the fallback uses

## Ranking

`src/recipes/ranking.ts` keeps all weights in `RANKING_WEIGHTS`:
- restriction and goal matches score positive; misses score negative
- full coverage, a trusted channel and a high share of high-confidence ingredients add points, as does fitting the time limit
- each already-picked recipe with the same main protein costs 2 points
- the user's rating adds 0.75 per star above 3 and subtracts below it; recipes rated 1 are excluded before ranking

`selectRanked` picks greedily, so the protein penalty spreads the variety. The agent prompt states the same priorities in words.

## Responses

Both meal-plan endpoints return:
- `recommendations[]`, each with:
  - the model's `whyItFits`
  - `matchedTags`, `allergySafety`, `healthNotes`
  - `labelCheck`, `trustedChannel`, `fitsTime`
  - `recipe`: the full extracted recipe, so the app needs no Gemini call
  - `evidence`: the ingredients behind each matched goal, plus the allergy notes
- `excluded[]`, each with a `reason` and a `code` (`allergen`, `uncertain`, `unavailable`, `too_long`, `rated_low`)
- `shoppingList` for the recommended recipes; every item has a stable `key` for checkbox state
- `planId` and `planVersion` of the saved plan
- `disclaimer`, `meta`

`recipe.nutrients` holds the USDA-based estimate (see below) and `recipe.nutritionBasis` says where the nutrition labels come from: `nutrients`, `model` (Gemini estimates in analyses made before nutrients existed) or `none`. Evidence carries the same basis (`nutrients`, `model-signals`, `none`).

## Nutrients: USDA FoodData Central

Gemini only extracts ingredients; nutrients are calculated in code (`src/nutrition/`) when `FDC_API_KEY` is set:
1. **Match** each ingredient to a Foundation or SR Legacy food. `pickFood` scores FDC's hits instead of taking the top one, which is often wrong ("chickpea" → chickpea flour, "carrot" → dehydrated carrot): every ingredient word must appear, product forms the ingredient doesn't name (flour, powder, juice, purée, brand items) are penalised, raw foods are preferred, and canned ones when the recipe uses a can. No confident match means unresolved. `data/fdc-overrides.json` fixes known mismatches.
2. **Cache** each mapping permanently (`fdc_mappings`, or `fdc-mappings.json` without a database), shared by every video. A "no match" is retried after 30 days.
3. **Grams**: mass units directly, volume through the density table or an FDC cup/tbsp portion, counts through FDC portions ("1 clove", "1 medium"). Low-confidence and vague amounts stay unresolved.
4. **Sum** per-100 g values and divide by servings: kcal, protein, fat, saturated fat, carbs, sugar, fibre, sodium. Unknown servings give totals only.
5. **Honesty**: `completeness` is the share of recipe mass resolved; below 0.7 the result is `partial` and goals aren't matched on it. Completeness is also tracked per nutrient, so no label rests on a nutrient most of the recipe didn't report. Every result is `estimated: true`, `source: "USDA FoodData Central"`.
6. **Labels** from fixed per-serving thresholds (`SIGNAL_THRESHOLDS`): high-protein ≥ 20 g, low-sodium ≤ 600 mg (moderate ≤ 1,000), high-fibre ≥ 8 g, low-carb ≤ 30 g, low-sugar ≤ 10 g, plus quick-prep (≤ 30 min) and whole-foods (nothing packaged). They replace the model's labels.

Nutrients are derived data, so cached analyses get them on read without another Gemini call (`NUTRITION_VERSION` triggers a recompute). If FDC is down the analysis is still returned, with `nutrients: null`, and retried next time.

## Profiles, saved plans and the meal log

The JJFit app owns identity and sends an opaque `userId`. These endpoints have no authentication yet: anyone who knows a `userId` can use them (see [safety-and-privacy.md](safety-and-privacy.md#privacy)).
- `PUT /api/users/:userId/profile` stores the profile fields of the meal-plan request; `consent: true` is required and its time recorded. `GET` returns it; `DELETE` erases the profile, every plan and the meal log.
- `POST /api/meal-plan` and `/api/meal-plan/agent` accept `userId` in place of a profile. Inline fields override the stored ones, except allergies, which are merged. An unknown `userId` is a 404, never an empty profile.
- Every meal-plan response is saved and returns `planId`. `GET /api/plans/:id` reads it, `PATCH /api/plans/:id/checked` stores ticked shopping-list keys.
- `POST /api/users/:userId/meals` logs `{ videoId, planId?, cooked, rating?, note? }`. Ratings feed back: digests show `userRating` and `cookedCount`, the prompt avoids recipes rated 2 or lower and brings back 4-5 now and then, the ranking adds a rating term, and recipes rated 1 are excluded in code.
- `POST /api/plans/:id/swap` with `{ videoId }` replaces one meal. Cheap path: the best-ranked safe cached recipe that fits the profile, isn't in the plan and keeps `check_plan_balance` within limits, with no Gemini call. Otherwise a single-slot agent run (1 search, 2 analyses). The shopping list is rebuilt, ticked items still in it stay ticked, and the plan version goes up. Allergies added to the profile since the plan was made also apply.

## Shopping list: `POST /api/shopping-list`

Built only from cached analyses; it never calls Gemini. `buildShoppingList` (`src/shopping/shopping-list.ts`) is a pure function:
1. Scale by `householdSize / recipe servings`, or by a per-item `servings` value. When servings are unknown, use the factor 1 and add a warning.
2. Normalise names (`src/recipes/normalize.ts`): singular, aliases (`garbanzo` → `chickpea`), preparation words dropped, product words such as `smoked` kept.
3. Convert to g, ml or counts (`src/recipes/units.ts`). Convert ml to g only for ingredients in a small density table; otherwise keep separate lines and warn.
4. Merge by name and unit, keeping `fromRecipes` links.
5. Round to buying units (380 g → 400 g, 1.3 cans → 2), with `exactAmount` alongside.
6. Group by supermarket section. Pantry staples go in a separate `pantry` group.
7. Unclear amounts show "amount unclear: check recipe" and are never invented.

## Trusted channels

`data/trusted-channels.json` is a team-reviewed list of `{ channelId, name, note }`; the path can be changed with `TRUSTED_CHANNELS_FILE`. Trusted results are listed first in search and get a ranking bonus. The file ships empty. There are no channel-scoped searches, because each costs 100 quota units.

## Not built yet

- the 7-day planner and weekly generation (see [plans/close-concept-gaps.md](plans/close-concept-gaps.md#5-later-not-in-this-plan))
- price data for real budget handling
