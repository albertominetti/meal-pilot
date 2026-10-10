import { normalizeToken } from '../videos/allergy.util';
import { Ingredient, Unit } from '../videos/analyzers/analysis.schema';

export interface LabeledIngredient {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

export interface LabeledVideo {
  videoId: string;
  title: string;
  channel: string;
  /** EU-14 allergens a careful human sees in the video or description. */
  expectedAllergens: string[];
  expectedIngredients?: LabeledIngredient[];
}

export interface IngredientScore {
  matched: number;
  unitCorrect: number;
  quantityWithinTolerance: number;
  expected: number;
}

export const QUANTITY_TOLERANCE = 0.2;

function sameIngredient(expected: string, actual: string): boolean {
  const e = normalizeToken(expected);
  const a = normalizeToken(actual);
  return a === e || a.includes(e) || e.includes(a);
}

/** Unit and quantity accuracy for the ingredients both sides agree exist. */
export function scoreIngredients(
  expected: LabeledIngredient[],
  actual: Ingredient[],
): IngredientScore {
  const score: IngredientScore = {
    matched: 0,
    unitCorrect: 0,
    quantityWithinTolerance: 0,
    expected: expected.length,
  };
  const used = new Set<number>();
  for (const exp of expected) {
    const idx = actual.findIndex((a, i) => !used.has(i) && sameIngredient(exp.name, a.name));
    if (idx < 0) continue;
    used.add(idx);
    const act = actual[idx];
    score.matched++;
    if (act.unit === exp.unit) score.unitCorrect++;
    if (exp.quantity === null) {
      if (act.quantity === null) score.quantityWithinTolerance++;
    } else if (
      act.quantity !== null &&
      act.unit === exp.unit &&
      Math.abs(act.quantity - exp.quantity) <= QUANTITY_TOLERANCE * exp.quantity
    ) {
      score.quantityWithinTolerance++;
    }
  }
  return score;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
