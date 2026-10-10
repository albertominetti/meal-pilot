import { checkTime, HEALTH_GOALS, HealthGoal, matchGoals } from '../meal-plan/profile-fit';
import { NUTRIENT_KEYS } from '../nutrition/fdc-food';
import { nutritionFacts } from '../nutrition/nutrition-facts';
import { NutrientTotals } from '../nutrition/nutrition';
import { normalizeToken } from '../videos/allergy.util';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { normalizeIngredientName } from './normalize';
import { restrictionCoverage } from './restrictions';

export const MAX_SAME_PROTEIN = 2;

export interface PlanBalanceRequest {
  restrictions?: string[];
  healthGoals?: HealthGoal[];
  maxCookMinutes?: number;
}

export interface PlanBalance {
  recipes: number;
  proteins: Record<string, number>;
  cuisines: Record<string, number>;
  repeatedRecipes: string[];
  totalPrepMinutes: number;
  maxPrepMinutes: number | null;
  unknownPrepTime: string[];
  overTimeLimit: string[];
  partialCoverage: string[];
  sharedIngredients: { count: number; names: string[] };
  /** Requested restrictions some selected recipe does not meet. */
  restrictionGaps: Array<{ restriction: string; videoIds: string[] }>;
  /** Requested goals no selected recipe covers. */
  uncoveredGoals: string[];
  /** Sum of one serving of each recipe with USDA-based nutrients. */
  nutrients: { recipesWithNutrients: number; perServingSum: NutrientTotals | null };
  warnings: string[];
}

function tally(values: Array<string | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v || 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Advice for the agent before submit_plan. It never rejects a plan; the
 * safety and time gates live in submit_plan.
 */
export function checkPlanBalance(analyses: VideoAnalysis[], request: PlanBalanceRequest): PlanBalance {
  const warnings: string[] = [];

  const proteins = tally(analyses.map((a) => a.mainProtein));
  for (const [protein, n] of Object.entries(proteins)) {
    if (!['none', 'other', 'unknown'].includes(protein) && n > MAX_SAME_PROTEIN) {
      warnings.push(`${n} recipes use ${protein} as the main protein; aim for at most ${MAX_SAME_PROTEIN}.`);
    }
  }
  const cuisines = tally(analyses.map((a) => a.cuisine?.toLowerCase()));

  const seenNames = new Map<string, string>();
  const repeatedRecipes: string[] = [];
  for (const a of analyses) {
    const key = normalizeToken(a.recipeName);
    if (seenNames.has(key)) repeatedRecipes.push(a.videoId);
    else seenNames.set(key, a.videoId);
  }
  if (repeatedRecipes.length) warnings.push(`Repeated recipes: ${repeatedRecipes.join(', ')}.`);

  const known = analyses.filter((a) => typeof a.prepMinutes === 'number');
  const totalPrepMinutes = known.reduce((s, a) => s + a.prepMinutes!, 0);
  const maxPrepMinutes = known.length ? Math.max(...known.map((a) => a.prepMinutes!)) : null;
  const unknownPrepTime = analyses.filter((a) => typeof a.prepMinutes !== 'number').map((a) => a.videoId);
  const overTimeLimit = analyses
    .filter((a) => checkTime(a, request.maxCookMinutes).fitsTime === false)
    .map((a) => a.videoId);
  if (overTimeLimit.length) {
    warnings.push(`Over the ${request.maxCookMinutes}-minute limit (submit_plan will reject): ${overTimeLimit.join(', ')}.`);
  }

  const partialCoverage = analyses.filter((a) => a.coverage !== 'full').map((a) => a.videoId);
  if (partialCoverage.length) warnings.push(`Partial coverage, prefer full: ${partialCoverage.join(', ')}.`);

  const usage = new Map<string, Set<string>>();
  for (const a of analyses) {
    for (const i of a.ingredients ?? []) {
      const name = normalizeIngredientName(i.name);
      if (!usage.has(name)) usage.set(name, new Set());
      usage.get(name)!.add(a.videoId);
    }
  }
  const shared = [...usage].filter(([, ids]) => ids.size > 1).map(([name]) => name).sort();

  const restrictionGaps = new Map<string, string[]>();
  for (const a of analyses) {
    for (const r of restrictionCoverage(a, request.restrictions).missing) {
      restrictionGaps.set(r, [...(restrictionGaps.get(r) ?? []), a.videoId]);
    }
  }
  for (const [r, ids] of restrictionGaps) {
    warnings.push(`Not tagged ${r}: ${ids.join(', ')}.`);
  }

  const goals = (request.healthGoals ?? []).filter((g) => HEALTH_GOALS.includes(g));
  const uncoveredGoals = goals.filter(
    (g) => !analyses.some((a) => matchGoals(a, [g]).matched.length > 0),
  );
  if (uncoveredGoals.length) warnings.push(`No recipe covers goals: ${uncoveredGoals.join(', ')}.`);

  const withNutrients = analyses.map((a) => nutritionFacts(a).perServing).filter((n): n is NutrientTotals => !!n);
  const perServingSum = withNutrients.length
    ? (Object.fromEntries(
        NUTRIENT_KEYS.map((k) => [k, Math.round(withNutrients.reduce((s, n) => s + n[k], 0) * 10) / 10]),
      ) as NutrientTotals)
    : null;
  if (withNutrients.length < analyses.length && goals.length) {
    warnings.push(
      `${analyses.length - withNutrients.length} of ${analyses.length} recipes have no reliable nutrient estimate; goals are checked on the rest.`,
    );
  }

  return {
    recipes: analyses.length,
    proteins,
    cuisines,
    repeatedRecipes,
    totalPrepMinutes,
    maxPrepMinutes,
    unknownPrepTime,
    overTimeLimit,
    partialCoverage,
    sharedIngredients: { count: shared.length, names: shared.slice(0, 15) },
    restrictionGaps: [...restrictionGaps].map(([restriction, videoIds]) => ({ restriction, videoIds })),
    uncoveredGoals,
    nutrients: { recipesWithNutrients: withNutrients.length, perServingSum },
    warnings,
  };
}
