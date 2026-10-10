import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import {
  LLM_CLIENT,
  LlmClient,
  LlmError,
  LlmFunctionCall,
  LlmStep,
  functionResultStep,
  userInputStep,
} from '../llm/llm-client';
import {
  ExcludedVideoDto,
  MEDICAL_DISCLAIMER,
  MealPlanResponseDto,
  RecommendationDto,
} from '../meal-plan/dto/meal-plan-response.dto';
import { MealPlanService } from '../meal-plan/meal-plan.service';
import { defaultSearchQuery, healthWarnings, normalizeProfile } from '../meal-plan/profile-fit';
import { VideoRef } from '../videos/analysis.schema';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { watchUrl } from '../videos/youtube.util';
import { YouTubeClient } from '../youtube/youtube.service';
import { AgentRun } from './agent-run';
import { FORCE_SUBMIT_MESSAGE, buildInitialMessage, buildSystemInstruction } from './agent.prompt';
import { AgentTool, SUBMIT_PLAN, ToolError, buildTools, toFunctionTools } from './agent.tools';
import { AgentMealPlanRequestDto, AgentMealPlanResponseDto } from './dto/agent-meal-plan.dto';

/** Below this much remaining time the next turn is forced to submit_plan. */
const FINAL_TURN_THRESHOLD_MS = 25_000;

/**
 * Agentic meal planner: Gemini drives search -> analyze -> submit with
 * function calling; the server owns budgets, allergy verdicts and plan
 * validation. Any failure degrades to the deterministic planner.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly config: AppConfig,
    private readonly analysis: VideoAnalysisService,
    private readonly mealPlan: MealPlanService,
    @Optional() private readonly youtube?: YouTubeClient,
  ) {}

  async run(dto: AgentMealPlanRequestDto): Promise<AgentMealPlanResponseDto> {
    const run = new AgentRun(dto, normalizeProfile(dto), {
      maxSteps: this.config.agentMaxSteps,
      maxSearches: this.youtube?.isEnabled() ? this.config.agentMaxSearches : 0,
      maxAnalyses: this.config.agentMaxAnalyses,
      timeoutMs: this.config.agentTimeoutMs,
    });

    let preExcluded: ExcludedVideoDto[] = [];
    if (dto.videoCandidates?.length) {
      const resolved = await this.mealPlan.resolveCandidates(dto);
      resolved.candidates.forEach((c) => run.refs.set(c.videoId, c));
      preExcluded = resolved.excluded;
    }

    if (this.config.llmMode !== 'live') {
      return this.fallback(run, 'llm_mock_mode', preExcluded);
    }

    const searchEnabled = Boolean(this.youtube?.isEnabled());
    const tools = buildTools({ analysis: this.analysis, youtube: this.youtube, config: this.config }).filter(
      (t) => searchEnabled || t.name !== 'search_videos',
    );
    const byName = new Map(tools.map((t) => [t.name, t]));
    const fnTools = toFunctionTools(tools);
    const systemInstruction = buildSystemInstruction({ searchEnabled, locale: dto.locale });
    const history: LlmStep[] = [userInputStep(buildInitialMessage(run))];

    let fallbackReason: string | undefined;
    let nudged = false;
    let forced = false;

    try {
      while (!run.plan) {
        if (run.step >= run.limits.maxSteps) {
          fallbackReason = 'step_budget_exhausted';
          break;
        }
        if (run.timeLeftMs <= 0) {
          fallbackReason = 'timeout';
          break;
        }
        run.step++;
        const finalTurn =
          run.step === run.limits.maxSteps ||
          run.timeLeftMs < FINAL_TURN_THRESHOLD_MS ||
          (run.analysesLeft === 0 && run.searchesLeft === 0);
        if (finalTurn && !forced) {
          history.push(userInputStep(FORCE_SUBMIT_MESSAGE));
          forced = true;
        }

        const res = await this.llm.create({
          model: this.config.geminiModel,
          systemInstruction,
          input: history,
          tools: fnTools,
          toolChoice: finalTurn ? { mode: 'any', allowedTools: [SUBMIT_PLAN] } : undefined,
          timeoutMs: Math.max(5_000, run.timeLeftMs),
        });
        run.inputTokens += res.usage?.inputTokens ?? 0;
        run.outputTokens += res.usage?.outputTokens ?? 0;
        history.push(...res.steps);

        if (res.functionCalls.length === 0) {
          if (nudged || forced) {
            fallbackReason = 'model_stopped_without_plan';
            break;
          }
          nudged = true;
          history.push(userInputStep(FORCE_SUBMIT_MESSAGE));
          continue;
        }

        const results = await Promise.all(res.functionCalls.map((c) => this.execute(c, byName, run)));
        history.push(...results);
      }
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'unknown';
      this.logger.warn(`Agent LLM failure at step ${run.step}: ${code} ${(err as Error)?.message ?? err}`);
      fallbackReason = `llm_error:${code}`;
    }

    if (run.plan) return this.fromPlan(run, preExcluded);
    return this.fallback(run, fallbackReason ?? 'no_plan', preExcluded);
  }

  private async execute(call: LlmFunctionCall, byName: Map<string, AgentTool>, run: AgentRun): Promise<LlmStep> {
    const started = Date.now();
    const tool = byName.get(call.name);
    const traceArgs = { ...(call.arguments ?? {}) };
    const finish = (ok: boolean, summary: string, payload: unknown) => {
      run.trace.push({ step: run.step, tool: call.name, args: traceArgs, ok, summary, durationMs: Date.now() - started });
      return functionResultStep(call, payload, !ok);
    };
    if (!tool) return finish(false, 'unknown tool', { error: `unknown tool ${call.name}` });
    const parsed = tool.args.safeParse(call.arguments ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ');
      return finish(false, 'invalid args', { error: `invalid_arguments: ${msg}` });
    }
    try {
      const result = await tool.execute(parsed.data, run);
      return finish(true, tool.summarize(result), result);
    } catch (err) {
      if (err instanceof ToolError) return finish(false, err.message.split(':')[0], { error: err.message });
      this.logger.warn(`Tool ${call.name} crashed: ${err}`);
      return finish(false, 'internal error', { error: 'internal_error' });
    }
  }

  private fromPlan(run: AgentRun, preExcluded: ExcludedVideoDto[]): AgentMealPlanResponseDto {
    const recommendations: RecommendationDto[] = run.plan!.items.map((item) => {
      const ev = run.evaluated.get(item.videoId)!;
      const a = ev.analysis;
      const warnings = healthWarnings(a, run.dto);
      return {
        videoId: a.videoId,
        url: watchUrl(a.videoId),
        title: a.title,
        channel: a.channel,
        whyItFits: item.whyItFits,
        matchedTags: ev.matchedTags,
        allergySafety: ev.verdict, // server verdict, never model text
        healthNotes: [item.healthNotes, ...warnings, 'Informational only — not medical advice.']
          .filter(Boolean)
          .join(' '),
        provider: a.provider,
      };
    });
    const base: MealPlanResponseDto = {
      recommendations,
      excluded: [...preExcluded, ...this.excludedFrom(run)],
      disclaimer: MEDICAL_DISCLAIMER,
      meta: this.meta(run),
    };
    return this.withAgent(base, run, false, undefined, run.plan!.notes);
  }

  /** Deterministic plan from whatever the run gathered (or a fresh pipeline run). */
  private async fallback(run: AgentRun, reason: string, preExcluded: ExcludedVideoDto[]): Promise<AgentMealPlanResponseDto> {
    if (reason !== 'llm_mock_mode') this.logger.warn(`Agent fallback: ${reason}`);

    if (run.evaluated.size > 0) {
      const ordered = [...run.evaluated.values()].sort((x, y) => y.matchedTags.length - x.matchedTags.length);
      const recommendations: RecommendationDto[] = [];
      for (const ev of ordered) {
        if (recommendations.length >= run.profile.maxResults) break;
        if (ev.verdict.status !== 'safe') continue;
        const r = this.mealPlan.evaluate(ev.analysis, run.dto);
        if (!('reason' in r)) recommendations.push(r);
      }
      const base: MealPlanResponseDto = {
        recommendations,
        excluded: [...preExcluded, ...this.excludedFrom(run)],
        disclaimer: MEDICAL_DISCLAIMER,
        meta: this.meta(run),
      };
      return this.withAgent(base, run, true, reason);
    }

    let candidates: VideoRef[] = [...run.refs.values()];
    if (!candidates.length && this.youtube?.isEnabled() && !run.dto.videoCandidates?.length) {
      try {
        candidates = (await this.youtube.search(defaultSearchQuery(run.dto), { maxResults: 8 })).map((d) => ({
          videoId: d.videoId,
          title: d.title,
          channel: d.channel,
          durationSec: d.durationSec,
        }));
        run.searches++;
      } catch (err) {
        this.logger.warn(`Fallback search failed: ${err}`);
      }
    }
    let res: MealPlanResponseDto;
    if (candidates.length) {
      res = await this.mealPlan.buildPlanFrom(run.dto, candidates);
    } else if (this.config.llmMode === 'mock' && !run.dto.videoCandidates?.length) {
      res = await this.mealPlan.buildPlan(run.dto); // demo seed list
    } else {
      res = { recommendations: [], excluded: [], disclaimer: MEDICAL_DISCLAIMER, meta: this.meta(run) };
    }
    res.excluded = [...preExcluded, ...res.excluded];
    return this.withAgent(res, run, true, reason);
  }

  private excludedFrom(run: AgentRun): ExcludedVideoDto[] {
    return [...run.evaluated.values()]
      .filter((ev) => ev.verdict.status !== 'safe')
      .map((ev) => ({
        videoId: ev.analysis.videoId,
        url: watchUrl(ev.analysis.videoId),
        title: ev.analysis.title,
        reason:
          ev.verdict.status === 'unsafe' ? `Blocked: ${ev.verdict.notes}` : `Needs review: ${ev.verdict.notes}`,
      }));
  }

  private meta(run: AgentRun): MealPlanResponseDto['meta'] {
    const evs = [...run.evaluated.values()];
    return {
      mode: this.config.llmMode,
      provider: this.analysis.provider(),
      model: this.config.llmMode === 'live' ? this.config.geminiModel : 'mock',
      analyzed: evs.length,
      fromCache: Math.max(0, evs.length - run.analysesStarted),
      failures: evs
        .filter((e) => e.analysis.status !== 'ok')
        .map((e) => ({ videoId: e.analysis.videoId, error: e.analysis.error ?? 'unknown' })),
      durationMs: run.elapsedMs,
    };
  }

  private withAgent(
    base: MealPlanResponseDto,
    run: AgentRun,
    fallbackUsed: boolean,
    fallbackReason?: string,
    agentNotes?: string,
  ): AgentMealPlanResponseDto {
    base.meta.durationMs = run.elapsedMs;
    return {
      ...base,
      agent: {
        steps: run.step,
        searches: run.searches,
        analyses: run.analysesStarted,
        fallbackUsed,
        fallbackReason,
        agentNotes,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        youtubeQuotaUsed: this.youtube?.isEnabled() ? this.youtube.quota().used : 0,
      },
      trace: run.dto.debug ? run.trace : undefined,
    };
  }
}
