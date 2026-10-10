/**
 * Parsing for USDA FoodData Central responses. Search hits, full and
 * abridged food details each spell nutrients differently; this reads all
 * three. Foundation and SR Legacy values are per 100 g of edible food.
 */

export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'fat',
  'saturatedFat',
  'carbs',
  'sugar',
  'fiber',
  'sodium',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;

/**
 * FDC nutrient numbers, in order of preference. Foundation foods often
 * report energy only as Atwater factors (957, 958) instead of 208, and total
 * sugars as 269.3 instead of 269. Sodium is in mg, everything else g or kcal.
 */
const NUTRIENT_NUMBERS: Record<NutrientKey, string[]> = {
  kcal: ['208', '957', '958'],
  protein: ['203'],
  fat: ['204'],
  saturatedFat: ['606'],
  carbs: ['205'],
  sugar: ['269', '269.3'],
  fiber: ['291'],
  sodium: ['307'],
};

export interface Portion {
  /** e.g. "1 cup, chopped", "1 clove", "1 medium (2-3/4\" dia)" */
  label: string;
  amount: number;
  gramWeight: number;
}

export interface FdcFood {
  fdcId: number;
  description: string;
  dataType: string;
  /** Per 100 g. */
  nutrients: Nutrients;
  portions: Portion[];
}

type RawNutrient = {
  nutrientNumber?: string;
  number?: string;
  unitName?: string;
  value?: number;
  amount?: number;
  nutrient?: { number?: string; unitName?: string };
};

type RawPortion = {
  amount?: number;
  gramWeight?: number;
  modifier?: string;
  portionDescription?: string;
  measureUnit?: { name?: string; abbreviation?: string };
};

export type RawFood = {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
};

export function parseNutrients(raw: RawNutrient[] | undefined): Nutrients {
  const byNumber = new Map<string, number>();
  for (const n of raw ?? []) {
    const number = n.nutrientNumber ?? n.number ?? n.nutrient?.number;
    const unit = (n.unitName ?? n.nutrient?.unitName ?? '').toLowerCase();
    const value = n.value ?? n.amount;
    if (!number || typeof value !== 'number') continue;
    // Energy is also reported in kJ under other numbers; never mix units.
    if (['208', '957', '958'].includes(number) && unit !== 'kcal') continue;
    if (!byNumber.has(number)) byNumber.set(number, value);
  }
  const out: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const number = NUTRIENT_NUMBERS[key].find((n) => byNumber.has(n));
    if (number) out[key] = byNumber.get(number)!;
  }
  return out;
}

export function parsePortions(raw: RawPortion[] | undefined): Portion[] {
  const out: Portion[] = [];
  for (const p of raw ?? []) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    const text = [unit, p.modifier, p.portionDescription].filter(Boolean).join(', ');
    out.push({
      label: `${p.amount ?? 1} ${text}`.trim().toLowerCase(),
      amount: p.amount && p.amount > 0 ? p.amount : 1,
      gramWeight: p.gramWeight,
    });
  }
  return out;
}

export function parseFood(raw: RawFood): FdcFood {
  return {
    fdcId: raw.fdcId,
    description: raw.description,
    dataType: raw.dataType,
    nutrients: parseNutrients(raw.foodNutrients),
    portions: parsePortions(raw.foodPortions),
  };
}
