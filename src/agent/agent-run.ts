import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { FeedbackMap } from '../users/feedback';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';

export interface TraceItem {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  resultSummary: string;
}

export interface AgentRunBudgets {
  maxSteps: number;
  maxAnalyses: number;
  maxSearches: number;
  timeoutMs: number;
}

export interface AcceptedRecommendation {
  videoId: string;
  whyItFits: string;
  healthNotes?: string;
}

export interface AcceptedPlan {
  recommendations: AcceptedRecommendation[];
  notes?: string;
}

export class AgentRun {
  public stepCount = 0;
  public searchCount = 0;
  public analysisCount = 0;
  public readonly startTime = Date.now();
  public readonly trace: TraceItem[] = [];
  public readonly analyzedVideos = new Map<string, VideoAnalysis>();
  public readonly videoSafetyVerdicts = new Map<
    string,
    { status: 'safe' | 'uncertain' | 'unsafe'; notes: string }
  >();
  public acceptedPlan: AcceptedPlan | null = null;

  constructor(
    public readonly request: MealPlanRequestDto,
    public readonly budgets: AgentRunBudgets,
    public readonly feedback: FeedbackMap = new Map(),
    public readonly excludedVideoIds: ReadonlySet<string> = new Set(),
  ) {}

  get isTimeExhausted(): boolean {
    return Date.now() - this.startTime >= this.budgets.timeoutMs;
  }

  get isBudgetExhausted(): boolean {
    return (
      this.stepCount >= this.budgets.maxSteps ||
      this.isTimeExhausted ||
      (this.searchCount >= this.budgets.maxSearches &&
        this.analysisCount >= this.budgets.maxAnalyses)
    );
  }
}
