# Plan: Make MealPilot's Gemini integration real and agentic

Status: **implemented (v0.2.0)**. Live Gemini/YouTube calls are not yet verified (see "Implementation notes") · Author: Fabian (drafted with Claude) · Date: 2026-10-10

## Implementation notes (2026-10-10)

- All phases are implemented in one change set. 71 unit + e2e tests pass offline, using `ScriptedLlmClient`/`FakeYouTube` from `test/fakes.ts`.
- Decisions taken on the open questions:
  - `store: false`.
  - The YouTube key is optional. Without it, `search_videos` is not offered to the model.
  - Both endpoints are kept.
  - Budget defaults: 12 steps, 4 searches, 8 analyses, 150 s.
- `check_profile_fit` was folded into `analyze_video`'s result (`matchedTags`, `missingRestrictions`, `healthWarnings`) to save a round-trip per video.
- The SDK request shape (`POST /v1beta/interactions` with `store`, `tools`, `generation_config.tool_choice.allowed_tools`, `response_format`, and `video` input) was checked against `@google/genai@2.28` with a local stub server. **No real Gemini or YouTube call has been made yet.** Run `npm run smoke:live` and `npm run eval:analysis` before relying on live mode.
- Seed data stays mock-only (fake IDs). In live mode, `/meal-plan` without candidates searches YouTube, or returns 400 if search is off.

## 0. Where we are

| Area | Today | Problem |
|---|---|---|
| Gemini call | `GeminiService.analyzeWithGemini` sends a single prompt to `gemini-1.5-flash` via `@google/generative-ai` | The model is retired and the SDK is deprecated. The model only sees title and channel, so it guesses the recipe |
| Env loading | `npm start` = `node dist/main`, no dotenv/ConfigModule | `.env` is never read locally, so the app always runs in mock mode |
| Fallback | Any error → silently returns `mockAnalysis()` | **Safety bug:** in live mode, a failed call yields a title-keyword guess that can mark an allergen-containing video "safe" |
| Transcript | Field is model or mock prose | No real transcript or video content is used |
| Discovery | Request candidates or `data/videos.seed.json` (fake IDs) | No search |
| Ranking/explanations | Rule-based (`matchTags`, `explainFit`) | Fine to keep as the deterministic core |
| Cache | File cache keyed by `videoId` only, no versioning | Mock results get served after switching to live. Render free disk is ephemeral |

Target: a NestJS service where a Gemini agent turns a health profile into a meal plan. The agent searches YouTube, analyzes the real videos, checks safety through deterministic tools, and submits a validated plan. Allergy safety stays in code, not in the model.

## 1. Key decisions (please confirm)

1. **API surface: Interactions API** (`client.interactions.create`, `@google/genai` ≥ 2.3.0). Google now recommends it for new projects, and `generateContent` is "legacy but fully supported". It exposes `function_call`/`function_result` steps, which suits a tool loop. *Fallback:* if Interactions turns out to be awkward in Node, the same design works on `models.generateContent` with `functionDeclarations`. Hide the choice behind our own `LlmClient` interface so swapping is one file.
2. **Models.** `GEMINI_MODEL=gemini-3.8-flash` for the agent and video analysis (current stable Flash). Optionally `gemini-3.5-flash-lite` for cheap text-only steps. Both are configurable via env, never hard-coded.
3. **Privacy: `store: false`.** Health profiles shouldn't sit in Google's interaction store (1 day free / up to 55 days paid). Cost: we resend the full step history each turn, including thought steps "exactly as received", and lose implicit caching. Revisit if latency or cost hurt.
4. **Fallback policy.** Mock is used **only** when `MEALPILOT_LLM_MODE=mock`, or when it's `auto` and no key is set. In live mode, a failed analysis becomes `status: "unavailable"` and the video is **excluded as uncertain**, never mock-analyzed.
5. **Discovery: YouTube Data API v3** with a separate `YOUTUBE_API_KEY`. `search.list` costs 100 quota units of the 10,000/day default, which is about 90 searches/day. So cache searches and cap them per run.
6. **Endpoint shape.** Keep `POST /api/meal-plan` (deterministic pipeline, now with real analysis). Add `POST /api/meal-plan/agent` for the agentic flow. Merge them later once the agent is proven.

## 2. Phased delivery (one PR per phase)

### Phase 1: Foundation (≈1 day). Make the existing integration real

**1.1 Dependencies**
- `npm rm @google/generative-ai`
- `npm i @google/genai@^2.3 @nestjs/config zod`

**1.2 Config.** New `src/config/`:
- `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate })`
- Typed `AppConfig` with:
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL` (default `gemini-3.8-flash`)
  - `MEALPILOT_LLM_MODE` (`auto|live|mock`, default `auto`)
  - `YOUTUBE_API_KEY`
  - `AGENT_MAX_STEPS` (12)
  - `AGENT_MAX_ANALYSES` (8)
  - `AGENT_MAX_SEARCHES` (4)
  - `AGENT_TIMEOUT_MS` (90000)
  - `ANALYSIS_CONCURRENCY` (3)
- In `live` mode, fail fast at boot if the key is missing.
- Update `.env.example`, README and `render.yaml`. New secrets get `sync: false`.
- Check the existing key: it starts with `AQ.` rather than the usual `AIza…`. Confirm with a one-off call that it authenticates against the Gemini API.

**1.3 Provider split.** Replace `GeminiService` with:
```
src/llm/
  llm-client.interface.ts      // LlmClient: createInteraction(req) -> InteractionResult (thin, mockable)
  genai-llm-client.ts          // wraps @google/genai; retries 429/5xx with backoff (max 2)
  llm.module.ts                // factory provider picks client based on mode
src/videos/analyzers/
  video-analyzer.interface.ts  // analyze(video): Promise<VideoAnalysis>
  gemini-video-analyzer.ts
  mock-video-analyzer.ts       // current mockAnalysis(), moved unchanged (tests keep passing)
  analysis.schema.ts           // zod schema + JSON Schema export, ANALYSIS_SCHEMA_VERSION
```
Inject with a token (`VIDEO_ANALYZER`), so `VideoAnalysisService` doesn't know which one it has.

**1.4 Structured output.**
- Use `response_format` with `mime_type: application/json` and a JSON Schema. Validate with zod.
- On a schema failure, retry once with the validation error appended. A second failure means `unavailable`.
- Delete the regex fence-stripping.
- Note: SDK 2.0 deprecated the old `response_format` field in favour of a "polymorphic" field. Check the exact name against the installed SDK typings before coding.

**1.5 Transparency.**
- `VideoAnalysis` gets `provider`, `model`, `status: ok|unavailable`, `error?`.
- The meal-plan response gets `meta: { mode, provider, model, analyzed, fromCache, failures[] }`.
- `GET /api/health` reports mode and model (never the key).

**1.6 Cache v2.**
- Key: `${videoId}.${provider}.${model}.v${ANALYSIS_SCHEMA_VERSION}.json`.
- Never write `unavailable` results or mock results while in live mode.
- Add `analyzedAt`-based TTL (default 30 days) and `DELETE /videos/cache` already exists.
- Ignore legacy un-versioned files.

**1.7 Tests**
- Factory picks mock/live correctly.
- Live failure → `unavailable` → excluded, using a fake `LlmClient` that throws.
- Cache keying and versioning.
- Schema retry path.
- The existing e2e stays offline (mode=mock).

**Done when:** with a key, `POST /api/meal-plan` returns `meta.provider = "gemini"` against a real model. Without one, it returns `mock`. And a forced Gemini error never produces a "safe" verdict.

### Phase 2: Real video understanding (≈1–1.5 days)

**2.1 Send the video.**
- Pass the YouTube URL as a video input (`{ type: "video", uri: "https://www.youtube.com/watch?v=<id>" }`) next to the text prompt.
- Constraints: public videos only (private/unlisted fail); preview feature; free tier max 8 h of video/day.
- Clipping and fps options are documented for uploaded files. Verify whether they work for YouTube URLs before relying on them for cost control.
- Map "not accessible" errors to `unavailable` with reason `video_not_public`.

**2.2 Richer, evidence-based schema** (`ANALYSIS_SCHEMA_VERSION = 2`):
```ts
{
  title, channel, durationSec?,
  recipeName: string,
  servings?: number,
  ingredients: { name: string; quantity?: string; timestamp?: string }[],
  steps: string[],                       // replaces fake "transcript"
  allergens: {
    allergen: CanonicalAllergen;         // enum, see 2.3
    evidence: string;                    // "spoken at 02:14: 'a spoonful of peanut butter'"
    timestamp?: string;
    confidence: 'confirmed' | 'likely' | 'possible';
  }[],
  crossContactNotes: string[],
  sodiumSources: string[],               // soy sauce, stock cubes, cured meats...
  nutritionSignals: NutritionSignal[],   // enum: low-sodium, low-carb, high-protein, high-fiber, quick-prep, whole-foods...
  restrictionTags: RestrictionTag[],     // enum aligned with KNOWN_RESTRICTION_TAGS
  summary: string,
  coverage: 'full' | 'partial'           // model admits if it couldn't see/hear everything
}
```
Enums in the JSON Schema stop free-text drift ("Gluten Free" vs "gluten-free").

**2.3 Allergen model**
- Canonical enum = EU 14 allergens (Reg. 1169/2011, relevant for Austria): gluten, crustaceans, eggs, fish, peanuts, soy, milk, tree nuts, celery, mustard, sesame, sulphites, lupin, molluscs.
- Extend `ALIAS_MAP` in `allergy.util.ts` for celery, mustard, lupin, molluscs and sulphites, and split shellfish into crustaceans/molluscs.
- Map user free-text allergies to canonical ones with the existing alias logic. Unmapped user allergies stay free text and are substring-matched against ingredients (current behaviour).

**2.4 Safety rules** (update `evaluateAllergySafety`; table-driven tests):

| Condition | Verdict |
|---|---|
| Analysis `unavailable` | uncertain (excluded) |
| Any matching allergen with `confirmed`/`likely` | unsafe |
| Matching allergen `possible`, or matched in `crossContactNotes` | uncertain |
| Alias hit in ingredients/steps text | unsafe |
| `coverage: partial` and user has severe allergies | uncertain |
| Otherwise | safe (with "verify recipe" note) |

**2.5 Throughput**
- Analyze candidates in parallel with a small limiter (`ANALYSIS_CONCURRENCY`) instead of the current sequential loop.
- Keep the `max` early-exit.

**2.6 Seed data**
- Replace the fake IDs with ~5 real public recipe videos that cover the test cases (a peanut dish, a shellfish dish, a vegan dish, a low-sodium dish).
- Keep the mock seed for tests under `test/fixtures/`.

**2.7 Eval set (gate for enabling live by default)**
- `eval/videos.labeled.json`: 10–15 real videos with hand-labelled allergens.
- `npm run eval:analysis` (live, not in CI) reports allergen recall/precision.
- Target: **100% recall on confirmed allergens.** Precision can be lower, since over-flagging is acceptable.

### Phase 3: YouTube discovery (≈1 day)

**3.1 `src/youtube/youtube.service.ts`** (plain `fetch`, no googleapis dependency)
- `search(query, opts)`:
  - Calls `search.list` with `part=snippet`, `type=video`, `videoEmbeddable=true`, `safeSearch=strict`, `relevanceLanguage`, and `videoDuration=medium` (4–20 min, which keeps Gemini cost sane). Returns IDs only.
  - Costs 100 units. Cache results 24 h by normalised query.
- `getDetails(ids[])`:
  - Calls `videos.list` with `part=snippet,contentDetails,status` in batches of 50 (1 unit).
  - Returns title, channel, duration, `privacyStatus`, `embeddable` and language.
  - Filter out non-public videos and anything over e.g. 25 min.
- Interface plus `FakeYouTubeService` for tests.

**3.2 Use it in the existing pipeline.** User-supplied candidates get their real title and channel from `getDetails` (instead of `"YouTube video <id>"`), and unavailable ones are dropped early.

**3.3 Quota protection**
- Count units per day in memory.
- Refuse searches above a configurable threshold, and tell the caller so.

### Phase 4: The agent (≈2–3 days)

**4.1 Module layout**
```
src/agent/
  agent.module.ts
  agent.controller.ts          // POST /api/meal-plan/agent  (+ optional SSE variant later)
  agent.service.ts             // the loop
  agent.prompt.ts              // system instruction builder
  agent-run.ts                 // per-run state: budgets, analyzed set, trace
  tools/
    tool.interface.ts          // { name, description, parameters (JSON Schema), zodArgs, execute(args, run) }
    search-videos.tool.ts
    get-video-details.tool.ts
    analyze-video.tool.ts
    list-known-videos.tool.ts
    check-profile-fit.tool.ts
    submit-plan.tool.ts
  fallback-planner.ts          // deterministic plan from whatever got analyzed
```

**4.2 Tools.** The model only sees compact results; full data stays server-side in `AgentRun`.

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `search_videos` | `query`, `maxResults≤10` | `[{videoId,title,channel,durationSec,alreadyAnalyzed}]` | counts against `AGENT_MAX_SEARCHES`, filtered via `getDetails` |
| `list_known_videos` | `tags?` | cached analyses (id, title, tags, allergens) | free, so it encourages reuse |
| `analyze_video` | `videoId` | `{recipeName, tags, signals, sodiumSources, allergySafety: {status, notes}}` | **verdict is computed server-side by `evaluateAllergySafety` and attached**; counts against `AGENT_MAX_ANALYSES` |
| `check_profile_fit` | `videoId` | deterministic `matchedTags` + gaps vs requested restrictions | reuses `matchTags` |
| `submit_plan` | `recommendations:[{videoId, whyItFits, healthNotes}]`, `notes?` | `{accepted:true}` or `{accepted:false, errors:[...]}` | terminal; see 4.4 |

**4.3 Loop** (`AgentService.run(profile)`)
```
history = [system-ish user turn with profile as JSON data]
for step in 1..AGENT_MAX_STEPS:
  if deadline passed or budgets exhausted: break
  res = llm.createInteraction({ model, system_instruction, tools, input: history, store: false })
  history.push(...res.steps)                     // keep thought + function_call steps verbatim
  calls = res.steps.filter(s => s.type === 'function_call')
  if calls.length === 0: break                   // model answered in text -> treat as "no plan"
  results = await Promise.all(calls.map(executeTool))   // zod-validate args; errors returned as results, not thrown
  history.push(...results.map(toFunctionResultStep))    // call_id = call.id
  if run.acceptedPlan: break
if !run.acceptedPlan:
  plan = forceSubmit() ?? fallbackPlanner.build(run)    // one last turn restricted to submit_plan if the API supports allowed-function mode; else deterministic
return toResponse(plan, run.trace, meta)
```
- Tool errors are returned to the model as `{error}` so it can recover. They never crash the run.
- Every tool call is recorded in `run.trace`: name, args (health text redacted), duration, result size.

**4.4 Guardrails** (enforced in code, not in the prompt)
- `submit_plan` rejects:
  - any `videoId` not analyzed in this run (or the cache)
  - any video whose verdict isn't `safe`
  - duplicates
  - more than `maxResults`
  - an empty `whyItFits`
- The server, not the model, attaches `allergySafety`, `matchedTags`, `url` and the disclaimer to each accepted recommendation.
- **Prompt-injection hygiene:** titles, descriptions and analysis text are wrapped as data in tool results. The system prompt says tool content is untrusted. Budgets and validation can't be changed by model output.
- Hard caps: steps, searches, analyses, wall-clock. Per-request Gemini/YouTube cost is logged.
- Request rate limiting with `@nestjs/throttler` (e.g. 5/min/IP), because each call spends money and quota.

**4.5 System prompt** (outline for `agent.prompt.ts`)
- Role: a meal-video planner for a person with the given profile. Not a doctor.
- Procedure:
  1. Call `list_known_videos` first.
  2. Draft 2–4 targeted searches that use restrictions, health goals and preferences (e.g. "low sodium vegetarian lentil dinner").
  3. Analyze the most promising candidates.
  4. Drop anything not `safe`.
  5. Aim for variety (proteins, cuisines, prep time).
  6. Call `submit_plan` once you have `maxResults` safe matches or the budget is low.
- Never claim a dish is allergen-free; explain fit in terms of the analyzed evidence.
- Language: respond in the profile's language (optional `locale` field).

**4.6 Response**
- Same `recommendations`/`excluded`/`disclaimer` as today.
- Plus `meta` (mode, model, steps, searches, analyses, durationMs, fallbackUsed).
- Plus `trace` (only when `debug=true`).

**4.7 Later: streaming.** `POST /api/meal-plan/agent?stream=1` returns SSE events (`step`, `tool_call`, `tool_result`, `plan`) for a UI. Not needed for v1.

### Phase 5: Testing strategy

- **ScriptedLlmClient** (test double for `LlmClient`) replays canned step sequences. Scenarios:
  1. Happy path: search → analyze ×3 → submit → accepted.
  2. The model submits an unsafe video → `submit_plan` returns errors → the model resubmits a corrected plan.
  3. The model keeps searching → budget hit → fallback planner used, `meta.fallbackUsed = true`.
  4. Malformed tool args → zod error returned → recovery.
  5. LLM throws 429 twice → retry → success. A permanent failure gives a clean 503 with partial `meta`.
- **Unit:** each tool, the safety table (2.4), cache v2, the YouTube filters.
- **e2e (offline):** the agent endpoint with fakes for both LLM and YouTube.
- **Live smoke** (`npm run smoke:live`, needs keys, not in CI): one real agent run printing the trace and cost.
- **Eval** (2.7) gates switching `MEALPILOT_LLM_MODE` default to live in production.

### Phase 6: Deploy and ops

- `render.yaml`: add `GEMINI_MODEL`, `MEALPILOT_LLM_MODE`, `YOUTUBE_API_KEY` (`sync: false`) and agent budgets.
- **Render free plan:** the disk is ephemeral and the instance sleeps after inactivity, so the cache is lost on every restart. Options:
  - accept this for now
  - add a persistent disk (paid)
  - move the cache to Render Key Value or Postgres behind the existing `TranscriptCacheService` interface
- Agent runs may take 30–90 s. Check Render's request timeout and consider async jobs (`202` + `GET /runs/:id`) if runs grow.
- Logging: structured JSON with run id, step count, tokens and units used. Never log the health profile or keys.
- Privacy note in the README and Swagger description: profile text is sent to Google Gemini (`store: false`).

## 3. Suggested PR sequence

| PR | Scope | Depends on | Size |
|---|---|---|---|
| 1 | Config, `@google/genai`, provider split, structured output, fail-safe fallback, cache v2 | — | M |
| 2 | YouTube URL video input, schema v2, EU-14 allergens, safety table, concurrency, real seed | 1 | M |
| 3 | YouTubeService + candidate enrichment | 1 | S |
| 4 | Agent module, tools, loop, guardrails, `/meal-plan/agent` | 2, 3 | L |
| 5 | Eval set + live smoke scripts, Render/env/docs, throttling | 4 | S |

PR 1 alone fixes the "always mock" and unsafe-fallback issues and is worth shipping immediately.

## 4. Open questions

1. Is a separate YouTube Data API key OK, or should discovery stay user-supplied for now?
2. Is `store: false` acceptable despite higher latency/cost, or is server-side chaining with explicit `delete` after each run fine?
3. Should the agent replace `/api/meal-plan` eventually, or should both remain (deterministic = cheap/fast)?
4. Who hand-labels the eval videos? It's needed before live is the default.
5. Budget per request (max analyses/searches): is ~8 analyses and 4 searches the right trade-off?

## 5. References

- Gemini models (current IDs, deprecations): https://ai.google.dev/gemini-api/docs/models
- Interactions API overview (`store`, retention, SDK ≥2.3.0): https://ai.google.dev/gemini-api/docs/interactions-overview
- Function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Video understanding / YouTube URLs: https://ai.google.dev/gemini-api/docs/video-understanding
- `@google/genai` 2.0.0 release notes (Interactions breaking changes): https://newreleases.io/project/npm/@google/genai/release/2.0.0
- YouTube Data API quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
