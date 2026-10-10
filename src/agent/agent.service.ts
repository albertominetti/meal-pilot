import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LLM_CLIENT, LlmClient, InteractionStep } from '../llm/llm-client.interface';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import {
  ExcludedVideoDto,
  labelCheckFields,
  MEDICAL_DISCLAIMER,
  RecommendationDto,
} from '../meal-plan/dto/meal-plan-response.dto';
import { watchUrl } from '../videos/youtube.util';
import { AgentRun, AgentRunBudgets, TraceItem } from './agent-run';
import { buildAgentSystemPrompt } from './agent.prompt';
import { FallbackPlanner } from './fallback-planner';
import { AnalyzeVideoTool } from './tools/analyze-video.tool';
import { CheckProfileFitTool } from './tools/check-profile-fit.tool';
import { ListKnownVideosTool } from './tools/list-known-videos.tool';
import { SearchVideosTool } from './tools/search-videos.tool';
import { SubmitPlanTool } from './tools/submit-plan.tool';
import { AgentTool } from './tools/tool.interface';

export interface AgentMealPlanMeta {
  mode: 'live' | 'mock';
  provider: 'gemini' | 'mock';
  model: string;
  steps: number;
  searches: number;
  analyses: number;
  durationMs: number;
  fallbackUsed: boolean;
}

export interface AgentMealPlanResponse {
  recommendations: RecommendationDto[];
  excluded: ExcludedVideoDto[];
  disclaimer: string;
  meta: AgentMealPlanMeta;
  trace?: TraceItem[];
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === 'string' && val.length > 80) {
      sanitized[key] = `${val.slice(0, 80)}...`;
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    private readonly config: AppConfigService,
    private readonly listKnownTool: ListKnownVideosTool,
    private readonly searchTool: SearchVideosTool,
    private readonly analyzeTool: AnalyzeVideoTool,
    private readonly checkFitTool: CheckProfileFitTool,
    private readonly submitPlanTool: SubmitPlanTool,
    private readonly fallbackPlanner: FallbackPlanner,
  ) {}

  async run(
    dto: MealPlanRequestDto,
    debug = false,
  ): Promise<AgentMealPlanResponse> {
    const budgets: AgentRunBudgets = {
      maxSteps: this.config.agentMaxSteps,
      maxAnalyses: this.config.agentMaxAnalyses,
      maxSearches: this.config.agentMaxSearches,
      timeoutMs: this.config.agentTimeoutMs,
    };

    const run = new AgentRun(dto, budgets);
    const tools: AgentTool[] = [
      this.listKnownTool,
      this.searchTool,
      this.analyzeTool,
      this.checkFitTool,
      this.submitPlanTool,
    ];

    const toolMap = new Map<string, AgentTool>(
      tools.map((t) => [t.name, t]),
    );

    const llmTools = tools.map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const systemPrompt = buildAgentSystemPrompt(dto);
    const history: InteractionStep[] = [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: `Please construct a personalized meal plan according to my health profile: ${JSON.stringify(dto)}. Follow the operating procedure step-by-step.`,
          },
        ],
      },
    ];

    let fallbackUsed = false;

    for (let step = 1; step <= run.budgets.maxSteps; step++) {
      if (run.isTimeExhausted || run.isBudgetExhausted) {
        this.logger.log(`Agent loop ending: time or budget boundary reached (step ${step})`);
        break;
      }

      run.stepCount = step;

      let res;
      try {
        res = await this.llm.createInteraction({
          model: this.config.geminiModel,
          system_instruction: systemPrompt,
          input: history,
          tools: llmTools,
          store: false,
        });
      } catch (err) {
        this.logger.error(`LLM interaction failed at step ${step}: ${err}`);
        break;
      }

      history.push(...res.steps);

      const callSteps = res.steps.filter((s) => s.type === 'function_call');
      if (callSteps.length === 0) {
        this.logger.log(`Agent generated text response without tool call at step ${step}. Ending loop.`);
        break;
      }

      const results = await Promise.all(
        callSteps.map(async (call) => {
          const toolName = call.name || '';
          const tool = toolMap.get(toolName);
          const start = Date.now();
          let resultData: unknown;

          if (!tool) {
            resultData = { error: `Tool "${toolName}" is not recognized.` };
          } else {
            try {
              const rawArgs = call.arguments || {};
              const parsed = tool.zodSchema.safeParse(rawArgs);
              if (!parsed.success) {
                resultData = {
                  error: `Invalid tool arguments for ${toolName}: ${parsed.error.message}`,
                };
              } else {
                resultData = await tool.execute(parsed.data, run);
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              resultData = { error: `Execution error in ${toolName}: ${msg}` };
            }
          }

          const durationMs = Date.now() - start;
          const summary =
            typeof resultData === 'object'
              ? JSON.stringify(resultData).slice(0, 120)
              : String(resultData);

          run.trace.push({
            step,
            tool: toolName,
            args: sanitizeArgs(call.arguments || {}),
            durationMs,
            resultSummary: summary,
          });

          return {
            type: 'function_result',
            call_id: call.id || '',
            name: toolName,
            result:
              typeof resultData === 'string'
                ? resultData
                : JSON.stringify(resultData),
          };
        }),
      );

      history.push(...results);

      if (run.acceptedPlan) {
        this.logger.log(`Agent successfully submitted accepted plan at step ${step}`);
        break;
      }
    }

    if (!run.acceptedPlan) {
      this.logger.warn('Agent ended without accepted plan; activating fallback planner');
      run.acceptedPlan = this.fallbackPlanner.build(run);
      fallbackUsed = true;
    }

    return this.toResponse(run, fallbackUsed, debug);
  }

  private toResponse(
    run: AgentRun,
    fallbackUsed: boolean,
    debug: boolean,
  ): AgentMealPlanResponse {
    const recommendations: RecommendationDto[] = [];
    const excluded: ExcludedVideoDto[] = [];

    const plan = run.acceptedPlan;
    const recs = plan?.recommendations ?? [];

    for (const rec of recs) {
      const analysis = run.analyzedVideos.get(rec.videoId);
      const verdict = run.videoSafetyVerdicts.get(rec.videoId) ?? {
        status: 'safe' as const,
        notes: 'Verified safe by agent evaluation.',
      };

      recommendations.push({
        videoId: rec.videoId,
        url: watchUrl(rec.videoId),
        title: analysis?.title || `YouTube video ${rec.videoId}`,
        channel: analysis?.channel || 'Unknown channel',
        whyItFits: rec.whyItFits,
        matchedTags: [
          ...(analysis?.restrictionTags || []),
          ...(analysis?.nutritionSignals || []),
        ],
        allergySafety: verdict,
        healthNotes:
          rec.healthNotes ||
          `Estimated signals (model, not measured): ${(analysis?.nutritionSignals || []).join(', ') || 'whole-foods'}`,
        ...labelCheckFields(analysis),
      });
    }

    for (const [videoId, analysis] of run.analyzedVideos) {
      const verdict = run.videoSafetyVerdicts.get(videoId);
      if (analysis.status === 'unavailable') {
        excluded.push({
          videoId,
          url: watchUrl(videoId),
          title: analysis.title,
          reason: `Needs review: ${analysis.error || 'Video analysis unavailable'}`,
        });
      } else if (verdict && verdict.status !== 'safe') {
        excluded.push({
          videoId,
          url: watchUrl(videoId),
          title: analysis.title,
          reason:
            verdict.status === 'unsafe'
              ? `Blocked: ${verdict.notes}`
              : `Needs review: ${verdict.notes}`,
        });
      }
    }

    const meta: AgentMealPlanMeta = {
      mode: this.config.effectiveLlmMode,
      provider: this.config.effectiveLlmMode === 'live' ? 'gemini' : 'mock',
      model: this.config.geminiModel,
      steps: run.stepCount,
      searches: run.searchCount,
      analyses: run.analysisCount,
      durationMs: Date.now() - run.startTime,
      fallbackUsed,
    };

    return {
      recommendations,
      excluded,
      disclaimer: MEDICAL_DISCLAIMER,
      meta,
      trace: debug ? run.trace : undefined,
    };
  }
}
