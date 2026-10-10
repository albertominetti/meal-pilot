import { Ingredient, VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { normalizeIngredientName } from '../recipes/normalize';
import { isPantryStaple, Section, sectionFor, SECTIONS } from './sections';
import {
  BaseUnit,
  densityFor,
  formatAmount,
  roundToBuyingUnit,
  toBaseUnit,
} from '../recipes/units';

export const AMOUNT_UNCLEAR = 'amount unclear: check recipe';

export interface ShoppingListItem {
  name: string;
  /** Rounded to a buying unit; null when no reliable amount is known. */
  amount: number | null;
  unit: string | null;
  /** Exact scaled amount before rounding, in the same unit. */
  exactAmount: number | null;
  /** True when some or all of the amount could not be determined. */
  uncertain: boolean;
  note?: string;
  fromRecipes: string[];
}

export interface ShoppingListSection {
  section: Section;
  items: ShoppingListItem[];
}

export interface ShoppingList {
  householdSize: number;
  sections: ShoppingListSection[];
  /** Pantry staples ("you probably have this"). */
  pantry: ShoppingListItem[];
  warnings: string[];
}

export interface ShoppingListInput {
  analysis: Pick<VideoAnalysis, 'videoId' | 'recipeName' | 'servings' | 'ingredients'>;
  /** Servings wanted from this recipe; defaults to the household size. */
  servings?: number;
}

interface Line {
  name: string;
  amount: number | null;
  unit: BaseUnit | null;
  uncertain: boolean;
  videoId: string;
}

function isUncertain(i: Ingredient): boolean {
  return i.confidence === 'low' || i.quantity === null || i.unit === null || i.unit === 'pinch';
}

function toLines(input: ShoppingListInput, householdSize: number, warnings: string[]): Line[] {
  const { analysis } = input;
  const wanted = input.servings ?? householdSize;
  let factor = 1;
  if (analysis.servings && analysis.servings > 0) {
    factor = wanted / analysis.servings;
  } else {
    warnings.push(`Servings unknown for "${analysis.recipeName}"; amounts are for one batch of the recipe.`);
  }

  return analysis.ingredients.map((i) => {
    const name = normalizeIngredientName(i.name);
    const base = !isUncertain(i) ? toBaseUnit(i.quantity!, i.unit!) : null;
    if (!base) {
      return { name, amount: null, unit: null, uncertain: true, videoId: analysis.videoId };
    }
    return {
      name,
      amount: base.amount * factor,
      unit: base.unit,
      uncertain: false,
      videoId: analysis.videoId,
    };
  });
}

/** Folds ml into g when a reliable density exists and both appear. */
function unifyMassAndVolume(lines: Line[]): void {
  const byName = new Map<string, Set<BaseUnit | null>>();
  for (const l of lines) {
    if (!byName.has(l.name)) byName.set(l.name, new Set());
    byName.get(l.name)!.add(l.unit);
  }
  for (const l of lines) {
    const units = byName.get(l.name)!;
    if (l.unit === 'ml' && units.has('g')) {
      const density = densityFor(l.name);
      if (density !== null) {
        l.amount = l.amount! * density;
        l.unit = 'g';
      }
    }
  }
}

function toItem(name: string, group: Line[]): ShoppingListItem {
  const known = group.filter((l) => !l.uncertain);
  const fromRecipes = [...new Set(group.map((l) => l.videoId))];
  const someUnclear = known.length < group.length;
  if (known.length === 0) {
    return { name, amount: null, unit: null, exactAmount: null, uncertain: true, note: AMOUNT_UNCLEAR, fromRecipes };
  }
  const unit = known[0].unit!;
  const exact = known.reduce((sum, l) => sum + l.amount!, 0);
  const rounded = formatAmount(roundToBuyingUnit(exact, unit), unit);
  // exactAmount is in the same unit as amount (kg/l when rounded up past 1000).
  const divisor = rounded.unit === unit ? 1 : 1000;
  return {
    name,
    amount: rounded.amount,
    unit: rounded.unit,
    exactAmount: Math.round((exact / divisor) * 100) / 100,
    uncertain: someUnclear,
    ...(someUnclear ? { note: 'plus an unclear amount: check recipe' } : {}),
    fromRecipes,
  };
}

/**
 * Builds a merged, scaled shopping list from cached analyses. Pure: never
 * calls Gemini or YouTube. Amounts are never invented: unclear quantities
 * stay unclear.
 */
export function buildShoppingList(inputs: ShoppingListInput[], householdSize = 1): ShoppingList {
  const warnings: string[] = [];
  const lines = inputs.flatMap((input) => toLines(input, householdSize, warnings));
  unifyMassAndVolume(lines);

  // Group by name and unit. Unclear lines join the known group for the same name.
  const groups = new Map<string, Line[]>();
  const unitsByName = new Map<string, Set<BaseUnit>>();
  for (const l of lines.filter((x) => !x.uncertain)) {
    const key = `${l.name}|${l.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
    if (!unitsByName.has(l.name)) unitsByName.set(l.name, new Set());
    unitsByName.get(l.name)!.add(l.unit!);
  }
  for (const l of lines.filter((x) => x.uncertain)) {
    const units = unitsByName.get(l.name);
    const key = units ? `${l.name}|${[...units][0]}` : `${l.name}|?`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  for (const [name, units] of unitsByName) {
    if (units.size > 1) {
      warnings.push(`Could not merge ${name} (${[...units].join(' + ')}); listed separately.`);
    }
  }

  const bySection = new Map<Section, ShoppingListItem[]>();
  const pantry: ShoppingListItem[] = [];
  for (const [key, group] of groups) {
    const name = key.slice(0, key.lastIndexOf('|'));
    const item = toItem(name, group);
    if (isPantryStaple(name)) {
      pantry.push(item);
      continue;
    }
    const section = sectionFor(name);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(item);
  }

  const byName = (a: ShoppingListItem, b: ShoppingListItem) => a.name.localeCompare(b.name);
  return {
    householdSize,
    sections: SECTIONS.filter((s) => bySection.has(s)).map((section) => ({
      section,
      items: bySection.get(section)!.sort(byName),
    })),
    pantry: pantry.sort(byName),
    warnings,
  };
}
