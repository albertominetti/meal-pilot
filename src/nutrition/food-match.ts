import { singularize } from '../recipes/normalize';
import { FdcFood } from './fdc-food';

export interface MatchHints {
  /** The recipe uses a can or tin ("1 can chickpeas"). */
  canned: boolean;
}

/** Product forms that change the nutrients; they only match when the ingredient names them. */
const FORM_WORDS = [
  'flour',
  'powder',
  'dehydrated',
  'flakes',
  'dried',
  'mix',
  'pudding',
  'babyfood',
  'toddler',
  'infant',
  'juice',
  'beverage',
  'sweetened',
  'frozen',
  'bread',
  'breadstick',
  'ring',
  'soup',
  'sauce',
  'puree',
  'paste',
  'mayonnaise',
  'prepared',
  'sprouted',
  'candy',
  'snack',
  'cereal',
  'imitation',
  'restaurant',
  'fast',
];

const MIN_SCORE = 2;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize);
}

/** Brand or restaurant items are written in capitals in FDC ("DENNY'S, onion rings"). */
const BRAND = /\b[A-Z][A-Z'&]{2,}\b/;

export interface ScoredFood {
  food: FdcFood;
  score: number;
}

/**
 * Scores one FDC hit for an ingredient. Every ingredient word must appear;
 * words in the first two description segments ("Oil, olive, ...") count
 * extra, product forms the ingredient doesn't name are penalised, and raw
 * foods are preferred unless the recipe uses a can.
 */
export function scoreFood(name: string, hints: MatchHints, food: FdcFood): number {
  if (food.nutrients.kcal === undefined || food.nutrients.protein === undefined) return -Infinity;

  const nameWords = new Set(words(name));
  const segments = food.description.split(',').map(words);
  const descWords = new Set(segments.flat());
  const leading = new Set([...(segments[0] ?? []), ...(segments[1] ?? [])]);

  if (![...nameWords].every((w) => descWords.has(w))) return -Infinity;

  let score = 3;
  if ([...nameWords].every((w) => leading.has(w))) score += 2;
  for (const form of FORM_WORDS) {
    if (descWords.has(form) && !nameWords.has(form)) score -= 3;
  }
  if (BRAND.test(food.description)) score -= 4;

  const canned = descWords.has('canned');
  if (hints.canned) {
    score += canned ? 3 : -1;
    if (descWords.has('drained')) score += 1;
  } else {
    if (descWords.has('raw')) score += 1;
    if (canned) score -= 1;
  }

  if (Object.keys(food.nutrients).length === 8) score += 1;
  return score;
}

/** Best hit, or null when nothing is a confident match. Ties keep FDC's relevance order. */
export function pickFood(name: string, hints: MatchHints, hits: FdcFood[]): FdcFood | null {
  let best: ScoredFood | null = null;
  for (const food of hits) {
    const score = scoreFood(name, hints, food);
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { food, score };
  }
  return best?.food ?? null;
}
