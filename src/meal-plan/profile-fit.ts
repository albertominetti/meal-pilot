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
 * Which analysis signals or tags count as evidence for a goal. Until
 * nutrients are computed from a food database these are model estimates.
 * Goals with no entry cannot be verified from the analysis yet.
 */
const GOAL_EVIDENCE: Record<HealthGoal, string[]> = {
  'high-protein': ['high-protein'],
  'low-sodium': ['low-sodium'],
  'high-fiber': ['high-fiber'],
  'low-carb': ['low-carb'],
  'low-sugar': [],
  'weight-loss': [],
};

export interface GoalMatch {
  matched: HealthGoal[];
  missing: HealthGoal[];
  /** Goals the current analysis cannot speak to (no signal exists yet). */
  unverifiable: HealthGoal[];
}

export function matchGoals(
  analysis: Pick<VideoAnalysis, 'nutritionSignals' | 'restrictionTags'>,
  goals: readonly HealthGoal[] | undefined,
): GoalMatch {
  const evidence = new Set<string>([
    ...(analysis.nutritionSignals ?? []),
    ...(analysis.restrictionTags ?? []),
  ]);
  const result: GoalMatch = { matched: [], missing: [], unverifiable: [] };
  for (const goal of goals ?? []) {
    const signals = GOAL_EVIDENCE[goal];
    if (signals.length === 0) result.unverifiable.push(goal);
    else if (signals.some((s) => evidence.has(s))) result.matched.push(goal);
    else result.missing.push(goal);
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
