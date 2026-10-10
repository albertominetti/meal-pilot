import { z } from 'zod';
import { AppConfig } from '../config/app-config.service';
import type { LlmFunctionTool } from '../llm/llm-client';
import { matchTags, restrictionGaps, healthWarnings } from '../meal-plan/profile-fit';
import { evaluateAllergySafety } from '../safety/allergy-safety';
import type { VideoAnalysis, VideoRef } from '../videos/analysis.schema';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { YouTubeClient, YouTubeError } from '../youtube/youtube.service';
import type { AgentRun, EvaluatedVideo } from './agent-run';

export class ToolError extends Error {}

export interface AgentTool<A = any> {
  name: string;
  description: string;
  parameters: Record<string, any>;
  args: z.ZodType<A>;
  execute(args: A, run: AgentRun): Promise<unknown>;
  /** One-line, PII-free summary for the trace. */
  summarize(result: any): string;
}

export interface ToolDeps {
  analysis: VideoAnalysisService;
  youtube?: YouTubeClient;
  config: AppConfig;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const SUBMIT_PLAN = 'submit_plan';

export function toFunctionTools(tools: AgentTool[]): LlmFunctionTool[] {
  return tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
}

/** Record an analysis in the run with the deterministic verdict. */
export function recordEvaluation(run: AgentRun, analysis: VideoAnalysis): EvaluatedVideo {
  const ev: EvaluatedVideo = {
    analysis,
    verdict: evaluateAllergySafety(analysis, run.profile.allergies),
    matchedTags: matchTags(analysis, run.profile.restrictions, run.profile.healthText),
  };
  run.evaluated.set(analysis.videoId, ev);
  run.refs.set(analysis.videoId, {
    videoId: analysis.videoId,
    title: analysis.title,
    channel: analysis.channel,
    durationSec: analysis.durationSec,
  });
  return ev;
}

/** Compact view of an evaluated video for the model. */
function view(ev: EvaluatedVideo, run: AgentRun) {
  const a = ev.analysis;
  return {
    videoId: a.videoId,
    title: a.title,
    channel: a.channel,
    analysisStatus: a.status,
    recipeName: a.recipeName,
    allergySafety: ev.verdict.status,
    allergyNotes: ev.verdict.notes,
    matchedTags: ev.matchedTags,
    missingRestrictions: restrictionGaps(a, run.profile.restrictions),
    nutritionSignals: a.nutritionSignals,
    healthWarnings: healthWarnings(a, run.dto),
    mainIngredients: a.ingredients.slice(0, 12).map((i) => i.name),
    summary: a.summary.slice(0, 500),
  };
}

export function buildTools(deps: ToolDeps): AgentTool[] {
  const { analysis, youtube, config } = deps;
  const searchEnabled = Boolean(youtube?.isEnabled());

  const listKnown: AgentTool<{ limit?: number }> = {
    name: 'list_known_videos',
    description:
      'List videos already analyzed earlier (cache) plus any candidate videos the user supplied. Free: does not use the analysis budget. Call this first.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max entries (default 20)' } },
    },
    args: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    async execute({ limit = 20 }, run) {
      const out: unknown[] = [];
      for (const a of analysis.known().slice(0, limit)) {
        out.push(view(run.evaluated.get(a.videoId) ?? recordEvaluation(run, a), run));
      }
      const candidates = [...run.refs.values()]
        .filter((r) => !run.evaluated.has(r.videoId))
        .map((r) => ({ videoId: r.videoId, title: r.title, channel: r.channel, analyzed: false }));
      return { analyzed: out, userCandidatesNotYetAnalyzed: candidates, budget: run.budgetSummary() };
    },
    summarize: (r) => `${r.analyzed?.length ?? 0} cached, ${r.userCandidatesNotYetAnalyzed?.length ?? 0} candidates`,
  };

  const search: AgentTool<{ query: string; maxResults?: number }> = {
    name: 'search_videos',
    description: searchEnabled
      ? `Search YouTube for public recipe videos (4-${config.maxVideoMinutes} min). Uses 1 search from the budget. Write specific queries combining dish type, dietary restrictions and health goals.`
      : 'YouTube search is NOT configured on this server. Calling it returns an error; use list_known_videos and the user-supplied candidates instead.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "low sodium vegetarian lentil soup recipe"' },
        maxResults: { type: 'integer', description: '1-10, default 8' },
      },
      required: ['query'],
    },
    args: z.object({ query: z.string().min(3).max(200), maxResults: z.number().int().min(1).max(10).optional() }),
    async execute({ query, maxResults = 8 }, run) {
      if (!youtube || !searchEnabled) throw new ToolError('search_unavailable: YOUTUBE_API_KEY not configured');
      if (run.searchesLeft <= 0) throw new ToolError('search_budget_exhausted: analyze or submit what you have');
      run.searches++;
      try {
        const results = await youtube.search(query, { maxResults, language: run.dto.locale?.slice(0, 2) });
        return {
          results: results.map((d) => {
            run.refs.set(d.videoId, { videoId: d.videoId, title: d.title, channel: d.channel, durationSec: d.durationSec });
            return {
              videoId: d.videoId,
              title: d.title,
              channel: d.channel,
              minutes: Math.round(d.durationSec / 60),
              alreadyAnalyzed: run.evaluated.has(d.videoId) || Boolean(analysis.cached(d.videoId)),
            };
          }),
          budget: run.budgetSummary(),
        };
      } catch (err) {
        if (err instanceof YouTubeError) throw new ToolError(`${err.code}: ${err.message}`);
        throw err;
      }
    },
    summarize: (r) => `${r.results?.length ?? 0} results`,
  };

  const analyze: AgentTool<{ videoId: string }> = {
    name: 'analyze_video',
    description:
      'Watch and analyze one YouTube video: ingredients, allergens, nutrition signals. Returns the server-computed allergySafety verdict (safe/uncertain/unsafe) for this user — only "safe" videos can be recommended. Uses 1 analysis from the budget unless already cached. You may call it for several videos in parallel.',
    parameters: {
      type: 'object',
      properties: { videoId: { type: 'string', description: '11-character YouTube video id' } },
      required: ['videoId'],
    },
    args: z.object({ videoId: z.string().regex(VIDEO_ID, 'must be an 11-character YouTube id') }),
    async execute({ videoId }, run) {
      const done = run.evaluated.get(videoId);
      if (done) return { ...view(done, run), note: 'already analyzed in this run' };

      const cached = analysis.cached(videoId);
      if (cached) return { ...view(recordEvaluation(run, cached), run), budget: run.budgetSummary() };

      let ref: VideoRef | undefined = run.refs.get(videoId);
      if (!ref && youtube?.isEnabled()) {
        const d = (await youtube.getDetails([videoId])).get(videoId);
        if (!d || d.privacyStatus !== 'public') throw new ToolError('video_not_found_or_not_public');
        ref = { videoId, title: d.title, channel: d.channel, durationSec: d.durationSec };
        run.refs.set(videoId, ref);
      }
      ref ??= { videoId, title: `YouTube video ${videoId}`, channel: 'Unknown channel' };
      if (ref.durationSec && ref.durationSec > config.maxVideoMinutes * 60) {
        throw new ToolError(`video_too_long: over ${config.maxVideoMinutes} minutes`);
      }
      if (run.analysesLeft <= 0) throw new ToolError('analysis_budget_exhausted: submit the plan with the safe videos you have');
      run.analysesStarted++;
      const { analysis: a } = await analysis.analyze(ref);
      return { ...view(recordEvaluation(run, a), run), budget: run.budgetSummary() };
    },
    summarize: (r) => `${r.analysisStatus ?? '?'} / ${r.allergySafety ?? '?'}`,
  };

  const submit: AgentTool<{ recommendations: { videoId: string; whyItFits: string; healthNotes?: string }[]; notes?: string }> = {
    name: SUBMIT_PLAN,
    description:
      'Submit the final meal plan. Only videos analyzed in this run with allergySafety "safe" are accepted. If rejected, fix the listed errors and call again. This ends the task.',
    parameters: {
      type: 'object',
      properties: {
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              videoId: { type: 'string' },
              whyItFits: {
                type: 'string',
                description: '2-4 sentences, specific to this user: restrictions met, health goals, what to adjust (e.g. halve the soy sauce).',
              },
              healthNotes: { type: 'string', description: 'Optional: sodium/carb/portion advice for this recipe. No diagnoses.' },
            },
            required: ['videoId', 'whyItFits'],
          },
        },
        notes: { type: 'string', description: 'Optional short note to the user about the overall plan' },
      },
      required: ['recommendations'],
    },
    args: z.object({
      recommendations: z
        .array(
          z.object({
            videoId: z.string(),
            whyItFits: z.string().min(20).max(1200),
            healthNotes: z.string().max(800).optional(),
          }),
        )
        .max(20),
      notes: z.string().max(1000).optional(),
    }),
    async execute({ recommendations, notes }, run) {
      const errors: string[] = [];
      const seen = new Set<string>();
      if (recommendations.length > run.profile.maxResults) {
        errors.push(`too many recommendations: max ${run.profile.maxResults}`);
      }
      for (const r of recommendations) {
        if (seen.has(r.videoId)) errors.push(`${r.videoId}: duplicate`);
        seen.add(r.videoId);
        const ev = run.evaluated.get(r.videoId);
        if (!ev) errors.push(`${r.videoId}: not analyzed in this run — call analyze_video first`);
        else if (ev.verdict.status !== 'safe') errors.push(`${r.videoId}: allergySafety is ${ev.verdict.status}; remove it`);
      }
      if (recommendations.length === 0 && run.safeVideoIds().length > 0) {
        errors.push(`empty plan but safe videos exist: ${run.safeVideoIds().join(', ')}`);
      }
      if (errors.length) return { accepted: false, errors };
      run.plan = { items: recommendations, notes };
      return { accepted: true };
    },
    summarize: (r) => (r.accepted ? 'accepted' : `rejected: ${(r.errors ?? []).length} errors`),
  };

  return [listKnown, search, analyze, submit];
}
