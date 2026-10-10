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
| Cache | Versioned analysis cache with a 30-day TTL | `src/videos/transcript-cache.service.ts` |

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

`selectRanked` picks greedily, so the protein penalty spreads the variety. The agent prompt states the same priorities in words.

## Responses

Both meal-plan endpoints return:
- `recommendations[]`, each with:
  - the model's `whyItFits`
  - `matchedTags`, `allergySafety`, `healthNotes`
  - `labelCheck`, `trustedChannel`, `fitsTime`
  - `recipe`: the full extracted recipe, so the app needs no Gemini call
  - `evidence`: the ingredients behind each matched goal, plus the allergy notes
- `excluded[]`, each with a `reason` and a `code` (`allergen`, `uncertain`, `unavailable`, `too_long`)
- `shoppingList` for the recommended recipes
- `disclaimer`, `meta`

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

These are planned in [plans/close-concept-gaps.md](plans/close-concept-gaps.md):
- nutrients from USDA FoodData Central (Phase 5)
- Neon Postgres storage (Phase 6)
- user profiles, meal log and meal swap (Phase 7)
- the 7-day planner
