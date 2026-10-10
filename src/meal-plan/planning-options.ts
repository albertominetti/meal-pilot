import type { AgentRunBudgets } from '../agent/agent-run';
import type { FeedbackMap } from '../users/feedback';

/** Per-run context both planners accept on top of the profile. */
export interface PlanningOptions {
  /** The user's ratings and cooked counts from the meal log. */
  feedback?: FeedbackMap;
  /** Never recommend these (a swap excludes the plan's current recipes). */
  excludeVideoIds?: string[];
  /** Agent only: tighter budgets, e.g. for a single-slot swap. */
  budgets?: Partial<AgentRunBudgets>;
}
