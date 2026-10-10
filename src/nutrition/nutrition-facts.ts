import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { NutrientKey } from './fdc-food';
import { MIN_COMPLETENESS, NutrientTotals } from './nutrition';

/**
 * Fixed per-serving thresholds (one serving is one meal). They replace the
 * model's labels once nutrients are computed.
 * - high-protein: at least 20 g protein
 * - low-sodium: at most 600 mg sodium; moderate-sodium: at most 1,000 mg
 * - high-fiber: at least 8 g fibre
 * - low-carb: at most 30 g carbohydrate
 * - low-sugar: at most 10 g total sugars
 * Not medical targets: they only sort recipes, and the app shows them as estimates.
 */
export const SIGNAL_THRESHOLDS = {
  highProteinG: 20,
  lowSodiumMg: 600,
  moderateSodiumMg: 1000,
  highFiberG: 8,
  lowCarbG: 30,
  lowSugarG: 10,
  quickPrepMinutes: 30,
} as const;

/** Labels that describe nutrients; the model also puts some in restrictionTags. */
export const NUTRIENT_TAGS = new Set(['low-sodium', 'moderate-sodium', 'high-protein', 'high-fiber', 'low-carb', 'low-sugar']);

/** Which nutrient each nutrient label rests on. */
export const SIGNAL_NUTRIENT: Record<string, NutrientKey> = {
  'high-protein': 'protein',
  'low-sodium': 'sodium',
  'moderate-sodium': 'sodium',
  'high-fiber': 'fiber',
  'low-carb': 'carbs',
  'low-sugar': 'sugar',
};

/**
 * - nutrients: computed from USDA FoodData Central (completeness >= 0.7)
 * - model: Gemini's estimates, from analyses made before nutrients existed
 * - none: no nutrient basis; only prep time and whole-foods are known
 */
export type NutritionBasis = 'nutrients' | 'model' | 'none';

export type FactsInput = Pick<
  VideoAnalysis,
  'nutrition' | 'nutritionSignals' | 'restrictionTags' | 'prepMinutes' | 'ingredients'
>;

export interface NutritionFacts {
  basis: NutritionBasis;
  signals: string[];
  /** Restriction tags with model nutrient labels replaced when nutrients are computed. */
  tags: string[];
  perServing: NutrientTotals | null;
  /** True when the nutrient behind a label was reported for enough of the recipe. */
  covers(signal: string): boolean;
}

function nutrientSignals(perServing: NutrientTotals, covered: (k: NutrientKey) => boolean): string[] {
  const t = SIGNAL_THRESHOLDS;
  const out: string[] = [];
  if (covered('protein') && perServing.protein >= t.highProteinG) out.push('high-protein');
  if (covered('sodium')) {
    if (perServing.sodium <= t.lowSodiumMg) out.push('low-sodium');
    else if (perServing.sodium <= t.moderateSodiumMg) out.push('moderate-sodium');
  }
  if (covered('fiber') && perServing.fiber >= t.highFiberG) out.push('high-fiber');
  if (covered('carbs') && perServing.carbs <= t.lowCarbG) out.push('low-carb');
  if (covered('sugar') && perServing.sugar <= t.lowSugarG) out.push('low-sugar');
  return out;
}

function recipeSignals(a: FactsInput): string[] {
  const out: string[] = [];
  if (typeof a.prepMinutes === 'number' && a.prepMinutes <= SIGNAL_THRESHOLDS.quickPrepMinutes) out.push('quick-prep');
  if ((a.ingredients ?? []).length && !(a.ingredients ?? []).some((i) => i.packaged)) out.push('whole-foods');
  return out;
}

export function nutritionFacts(a: FactsInput): NutritionFacts {
  const n = a.nutrition;
  const modelTags = a.restrictionTags ?? [];

  if (n && !n.partial && n.perServing) {
    const covered = (k: NutrientKey) => (n.nutrientCompleteness?.[k] ?? 0) >= MIN_COMPLETENESS;
    const signals = [...nutrientSignals(n.perServing, covered), ...recipeSignals(a)];
    const tags = [...modelTags.filter((t) => !NUTRIENT_TAGS.has(t)), ...signals.filter((s) => NUTRIENT_TAGS.has(s))];
    return {
      basis: 'nutrients',
      signals,
      tags: [...new Set(tags)],
      perServing: n.perServing,
      covers: (s) => !SIGNAL_NUTRIENT[s] || covered(SIGNAL_NUTRIENT[s]),
    };
  }

  const model = a.nutritionSignals ?? [];
  return {
    basis: model.length ? 'model' : 'none',
    signals: model.length ? [...model] : recipeSignals(a),
    tags: [...modelTags],
    perServing: null,
    // Gemini never estimated sugar, so it can't speak to low-sugar.
    covers: (s) => model.length > 0 && s !== 'low-sugar',
  };
}
