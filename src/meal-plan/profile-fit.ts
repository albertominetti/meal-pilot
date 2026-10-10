import { FactsInput, nutritionFacts } from '../nutrition/nutrition-facts';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';

export const HEALTH_GOALS = [
  'high-protein',
  'low-sodium',
  'high-fiber',
  'low-carb',
  'low-sugar',
  'weight-loss',
] as const;
export type HealthGoal = (typeof HEALTH_GOALS)[number];

export const BUDGETS = ['low', 'medium', 'high'] as const;
export type Budget = (typeof BUDGETS)[number];

/**
 * Which nutrition label counts as evidence for a goal. weight-loss has none:
 * calories alone can't say whether a meal suits a weight-loss plan.
 */
const GOAL_EVIDENCE: Record<HealthGoal, string | null> = {
  'high-protein': 'high-protein',
  'low-sodium': 'low-sodium',
  'high-fiber': 'high-fiber',
  'low-carb': 'low-carb',
  'low-sugar': 'low-sugar',
  'weight-loss': null,
};

export interface GoalMatch {
  matched: HealthGoal[];
  missing: HealthGoal[];
  /** Goals the current analysis cannot speak to (no signal exists yet). */
  unverifiable: HealthGoal[];
}

/**
 * Matches goals against computed nutrients when the recipe has them,
 * otherwise against the model's labels. A goal whose nutrient wasn't
 * reported for enough of the recipe is unverifiable, never "missing".
 */
export function matchGoals(analysis: Partial<FactsInput>, goals: readonly HealthGoal[] | undefined): GoalMatch {
  const facts = nutritionFacts(analysis as FactsInput);
  const evidence = new Set<string>([...facts.signals, ...facts.tags]);
  const result: GoalMatch = { matched: [], missing: [], unverifiable: [] };
  for (const goal of goals ?? []) {
    const signal = GOAL_EVIDENCE[goal];
    if (signal && evidence.has(signal)) result.matched.push(goal);
    else if (signal && facts.covers(signal)) result.missing.push(goal);
    else result.unverifiable.push(goal);
  }
  return result;
}

export interface TimeFit {
  /** null when either the limit or the recipe's prep time is unknown. */
  fitsTime: boolean | null;
  note?: string;
}

/**
 * Cooking time is a hard filter when known: a recipe that takes longer than
 * the user's limit is excluded. Unknown prep time is allowed with a note.
 */
export function checkTime(
  analysis: Pick<VideoAnalysis, 'prepMinutes'>,
  maxCookMinutes: number | undefined,
): TimeFit {
  if (!maxCookMinutes) return { fitsTime: null };
  if (analysis.prepMinutes === undefined || analysis.prepMinutes === null) {
    return {
      fitsTime: null,
      note: `Prep time unknown; check it fits your ${maxCookMinutes}-minute limit.`,
    };
  }
  if (analysis.prepMinutes > maxCookMinutes) {
    return {
      fitsTime: false,
      note: `Takes about ${analysis.prepMinutes} min, over your ${maxCookMinutes}-minute limit.`,
    };
  }
  return { fitsTime: true };
}
