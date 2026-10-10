import { Unit } from '../videos/analyzers/analysis.schema';

export type BaseUnit = 'g' | 'ml' | CountUnit;
export type CountUnit = 'piece' | 'can' | 'clove' | 'slice' | 'bunch';

const MASS: Partial<Record<Unit, number>> = { g: 1, kg: 1000 };
const VOLUME: Partial<Record<Unit, number>> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };
const COUNT = new Set<Unit>(['piece', 'can', 'clove', 'slice', 'bunch']);

/** g per ml, only for ingredients where the conversion is reliable. */
const DENSITY: Array<[RegExp, number]> = [
  [/\b(water|stock|broth)\b/, 1],
  [/\bmilk\b/, 1.03],
  [/\boil\b/, 0.92],
  [/\bflour\b/, 0.53],
  [/\bsugar\b/, 0.85],
  [/\brice\b/, 0.85],
];

export function densityFor(name: string): number | null {
  for (const [pattern, density] of DENSITY) {
    if (pattern.test(name)) return density;
  }
  return null;
}

export interface BaseAmount {
  amount: number;
  unit: BaseUnit;
}

/** Converts to g, ml or a count. Returns null for pinch or unknown units. */
export function toBaseUnit(quantity: number, unit: Unit): BaseAmount | null {
  if (MASS[unit] !== undefined) return { amount: quantity * MASS[unit]!, unit: 'g' };
  if (VOLUME[unit] !== undefined) return { amount: quantity * VOLUME[unit]!, unit: 'ml' };
  if (COUNT.has(unit)) return { amount: quantity, unit: unit as CountUnit };
  return null;
}

/** Rough grams for ranking ingredients by importance (not for nutrition). */
const COUNT_GRAMS: Record<CountUnit, number> = { can: 400, piece: 120, bunch: 100, slice: 30, clove: 5 };

export function approximateGrams(quantity: number | null, unit: Unit | null, name: string): number {
  if (quantity === null || unit === null) return 0;
  const base = toBaseUnit(quantity, unit);
  if (!base) return 0;
  if (base.unit === 'g') return base.amount;
  if (base.unit === 'ml') return base.amount * (densityFor(name) ?? 1);
  return base.amount * COUNT_GRAMS[base.unit];
}

/**
 * Rounds up to something you can buy or measure: 380 g -> 400 g,
 * 1.3 cans -> 2 cans, 12 ml -> 15 ml.
 */
export function roundToBuyingUnit(amount: number, unit: BaseUnit): number {
  if (unit === 'g' || unit === 'ml') {
    const step = amount < 20 ? 5 : amount < 100 ? 10 : amount < 1000 ? 50 : 100;
    return Math.ceil(amount / step - 1e-9) * step;
  }
  return Math.ceil(amount - 1e-9);
}

export function formatAmount(amount: number, unit: BaseUnit): { amount: number; unit: string } {
  if (unit === 'g' && amount >= 1000) return { amount: amount / 1000, unit: 'kg' };
  if (unit === 'ml' && amount >= 1000) return { amount: amount / 1000, unit: 'l' };
  return { amount, unit };
}
