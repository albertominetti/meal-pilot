import { normalizeIngredientName } from '../recipes/normalize';
import { approximateGrams } from '../recipes/units';
import { Ingredient, VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { FdcFood, NUTRIENT_KEYS, NutrientKey, Nutrients } from './fdc-food';
import { MatchHints } from './food-match';
import { resolveGrams } from './grams';

/** Bump when mapping or maths change; stored nutrients with another version are recomputed. */
export const NUTRITION_VERSION = 1;

/** Below this share of resolved recipe mass the numbers are a partial estimate. */
export const MIN_COMPLETENESS = 0.7;

/** Denominator mass for an ingredient whose amount is unknown ("salt to taste"). */
const NOMINAL_UNKNOWN_GRAMS = 20;

export type NutrientTotals = Record<NutrientKey, number>;

export interface NutritionResult {
  /** Null when servings are unknown: a whole-recipe figure would mislead. */
  perServing: NutrientTotals | null;
  total: NutrientTotals;
  servings: number | null;
  /** Share (0..1) of total recipe mass that was resolved to an FDC food and grams. */
  completeness: number;
  /** Per nutrient: share of recipe mass whose food reports that nutrient. */
  nutrientCompleteness: Record<NutrientKey, number>;
  /** completeness below MIN_COMPLETENESS: show as "partial estimate". */
  partial: boolean;
  unresolved: string[];
  estimated: true;
  source: 'USDA FoodData Central';
  version: number;
}

/** "1 can chickpeas" and "chickpea" map to different FDC foods (canned vs dry). */
export function matchHints(i: Ingredient): MatchHints {
  return { canned: i.unit === 'can' || /\b(canned|tinned|tin|can)\b/i.test(i.rawText) };
}

export function mappingKey(i: Ingredient): string {
  const name = normalizeIngredientName(i.name);
  return matchHints(i).canned ? `${name}|canned` : name;
}

function round(key: NutrientKey, value: number): number {
  return key === 'kcal' || key === 'sodium' ? Math.round(value) : Math.round(value * 10) / 10;
}

function zeros(): NutrientTotals {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as NutrientTotals;
}

/**
 * Sums ingredient nutrients from their FDC foods and divides by servings.
 * `foods` maps mappingKey to the matched food, or null for no match.
 */
export function computeNutrition(
  analysis: Pick<VideoAnalysis, 'ingredients' | 'servings'>,
  foods: Map<string, FdcFood | null>,
): NutritionResult {
  const total = zeros();
  const nutrientMass = zeros();
  let totalMass = 0;
  let resolvedMass = 0;
  const unresolved: string[] = [];

  for (const i of analysis.ingredients ?? []) {
    const food = foods.get(mappingKey(i)) ?? null;
    const grams = resolveGrams(i, food?.portions ?? []);
    const mass =
      grams.grams ?? (approximateGrams(i.quantity, i.unit, i.name) || NOMINAL_UNKNOWN_GRAMS);
    totalMass += mass;

    if (!food || grams.grams === null) {
      unresolved.push(i.name);
      continue;
    }
    resolvedMass += grams.grams;
    for (const key of NUTRIENT_KEYS) {
      const per100 = (food.nutrients as Nutrients)[key];
      if (per100 === undefined) continue;
      total[key] += (per100 * grams.grams) / 100;
      nutrientMass[key] += grams.grams;
    }
  }

  const share = (m: number) => (totalMass > 0 ? Math.round((m / totalMass) * 100) / 100 : 0);
  const servings = analysis.servings && analysis.servings > 0 ? analysis.servings : null;
  const completeness = share(resolvedMass);

  return {
    perServing: servings
      ? (Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, round(k, total[k] / servings)])) as NutrientTotals)
      : null,
    total: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, round(k, total[k])])) as NutrientTotals,
    servings,
    completeness,
    nutrientCompleteness: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, share(nutrientMass[k])])) as Record<
      NutrientKey,
      number
    >,
    partial: completeness < MIN_COMPLETENESS,
    unresolved: [...new Set(unresolved)],
    estimated: true,
    source: 'USDA FoodData Central',
    version: NUTRITION_VERSION,
  };
}
