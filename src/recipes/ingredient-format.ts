import { sanitizeUntrusted } from '../common/untrusted-text';
import { Ingredient } from '../videos/analyzers/analysis.schema';
import { approximateGrams } from './units';

const MAX_INGREDIENT_TEXT = 60;

export function isUnclear(i: Ingredient): boolean {
  return i.confidence === 'low' || i.quantity === null || i.unit === null || i.unit === 'pinch';
}

/** "chickpea 400 g"; unclear amounts fall back to the raw text: "olive oil (a splash)". */
export function formatIngredient(i: Ingredient): string {
  const text = isUnclear(i)
    ? `${i.name} (${i.rawText || 'amount unclear'})`
    : `${i.name} ${formatNumber(i.quantity!)} ${i.unit}`;
  return sanitizeUntrusted(text, MAX_INGREDIENT_TEXT);
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Ingredients ordered by approximate weight, heaviest first. */
export function byWeight(ingredients: Ingredient[]): Ingredient[] {
  return [...ingredients].sort(
    (a, b) => approximateGrams(b.quantity, b.unit, b.name) - approximateGrams(a.quantity, a.unit, a.name),
  );
}
