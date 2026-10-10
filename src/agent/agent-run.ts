import type { NormalizedProfile } from '../meal-plan/profile-fit';
import type { AllergySafetyVerdict } from '../safety/allergy-safety';
import type { VideoAnalysis, VideoRef } from '../videos/analysis.schema';
import type { AgentMealPlanRequestDto } from './dto/agent-meal-plan.dto';

export interface AgentLimits {
  maxSteps: number;
  maxSearches: number;
  maxAnalyses: number;
  timeoutMs: number;
}

export interface EvaluatedVideo {
  analysis: VideoAnalysis;
  verdict: AllergySafetyVerdict;
  matchedTags: string[];
}

export interface PlanItem {
  videoId: string;
  whyItFits: string;
  healthNotes?: string;
}

export interface TraceEntry {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  durationMs: number;
}

/** Mutable per-request state. Budgets and validation live here, not in the prompt. */
export class AgentRun {
  readonly startedAt = Date.now();
  step = 0;
  searches = 0;
  analysesStarted = 0;
  inputTokens = 0;
  outputTokens = 0;
  /** Videos the agent has seen (search results, candidates, cache). */
  readonly refs = new Map<string, VideoRef>();
  /** Videos analyzed (or loaded from cache) during this run, with verdicts. */
  readonly evaluated = new Map<string, EvaluatedVideo>();
  readonly trace: TraceEntry[] = [];
  plan?: { items: PlanItem[]; notes?: string };

  constructor(
    readonly dto: AgentMealPlanRequestDto,
    readonly profile: NormalizedProfile,
    readonly limits: AgentLimits,
  ) {}

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  get timeLeftMs(): number {
    return this.limits.timeoutMs - this.elapsedMs;
  }

  get searchesLeft(): number {
    return Math.max(0, this.limits.maxSearches - this.searches);
  }

  get analysesLeft(): number {
    return Math.max(0, this.limits.maxAnalyses - this.analysesStarted);
  }

  safeVideoIds(): string[] {
    return [...this.evaluated.values()].filter((e) => e.verdict.status === 'safe').map((e) => e.analysis.videoId);
  }

  budgetSummary() {
    return {
      stepsLeft: Math.max(0, this.limits.maxSteps - this.step),
      searchesLeft: this.searchesLeft,
      analysesLeft: this.analysesLeft,
      secondsLeft: Math.max(0, Math.round(this.timeLeftMs / 1000)),
      safeVideosSoFar: this.safeVideoIds().length,
      target: this.profile.maxResults,
    };
  }
}
