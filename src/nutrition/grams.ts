import { densityFor, toBaseUnit } from '../recipes/units';
import { Ingredient } from '../videos/analyzers/analysis.schema';
import { Portion } from './fdc-food';

export type GramsMethod = 'mass' | 'density' | 'portion' | 'label';

export type GramsResult =
  | { grams: number; method: GramsMethod }
  | { grams: null; reason: string };

const ML_PER: Record<string, number> = { cup: 240, tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5, 'fl oz': 29.57, ml: 1 };

/** FDC portion words that stand for one counted item, best first. */
const COUNT_PORTIONS: Record<string, RegExp[]> = {
  piece: [/\bmedium\b/, /\b(whole|piece|unit|fruit|each|item|egg)\b/, /\blarge\b/, /\bsmall\b/],
  clove: [/\bclove\b/],
  slice: [/\bslice\b/],
  can: [/\bcan\b/],
  bunch: [/\bbunch\b/],
};

function gramsPerMl(portions: Portion[]): number | null {
  for (const p of portions) {
    for (const [unit, ml] of Object.entries(ML_PER)) {
      if (new RegExp(`^[\\d.]+ ${unit}\\b`).test(p.label)) return p.gramWeight / (p.amount * ml);
    }
  }
  return null;
}

function gramsPerCount(unit: string, portions: Portion[]): number | null {
  for (const pattern of COUNT_PORTIONS[unit] ?? []) {
    const p = portions.find((x) => pattern.test(x.label));
    if (p) return p.gramWeight / p.amount;
  }
  return null;
}

/** "1 can (400g) chickpeas": an explicit weight per item in the text as said or written. */
function labelWeight(rawText: string): number | null {
  const m = rawText.match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Grams of one ingredient for nutrient maths. Mass units convert directly,
 * volume through the density table or an FDC cup/tbsp portion, counts
 * through FDC portions ("1 clove", "1 medium"). Anything else, and every
 * low-confidence amount, stays unresolved rather than guessed.
 */
export function resolveGrams(i: Ingredient, portions: Portion[]): GramsResult {
  if (i.confidence === 'low') return { grams: null, reason: 'low confidence' };
  if (i.quantity === null || i.quantity <= 0 || i.unit === null) return { grams: null, reason: 'no amount' };

  const base = toBaseUnit(i.quantity, i.unit);
  if (!base) return { grams: null, reason: `unit ${i.unit}` };
  if (base.unit === 'g') return { grams: base.amount, method: 'mass' };

  if (base.unit === 'ml') {
    const density = densityFor(i.name);
    if (density !== null) return { grams: base.amount * density, method: 'density' };
    const perMl = gramsPerMl(portions);
    if (perMl !== null) return { grams: base.amount * perMl, method: 'portion' };
    return { grams: null, reason: 'no density for volume' };
  }

  const perItem = gramsPerCount(base.unit, portions);
  if (perItem !== null) return { grams: base.amount * perItem, method: 'portion' };
  const label = base.amount === 1 ? labelWeight(i.rawText) : null;
  if (label !== null) return { grams: label, method: 'label' };
  return { grams: null, reason: `no portion for ${base.unit}` };
}
