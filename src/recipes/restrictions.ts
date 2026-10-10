import { normalizeToken } from '../videos/allergy.util';
import { FactsInput, nutritionFacts } from '../nutrition/nutrition-facts';

/** A tag that also satisfies other restrictions (vegan food is vegetarian). */
const IMPLIES: Record<string, string[]> = {
  vegan: ['vegetarian', 'dairy-free'],
};

export function normalizeRestriction(r: string): string {
  return normalizeToken(r).replace(/\s+/g, '-');
}

export interface RestrictionCoverage {
  matched: string[];
  missing: string[];
}

/** Every tag and label the recipe carries, nutrient labels from computed nutrients when available. */
export function recipeTags(analysis: Partial<FactsInput>): string[] {
  const facts = nutritionFacts(analysis as FactsInput);
  return [...new Set([...facts.tags, ...facts.signals])];
}

export function restrictionCoverage(
  analysis: Partial<FactsInput>,
  restrictions: string[] | undefined,
): RestrictionCoverage {
  const tags = new Set<string>();
  for (const t of recipeTags(analysis)) {
    tags.add(t);
    for (const implied of IMPLIES[t] ?? []) tags.add(implied);
  }
  const result: RestrictionCoverage = { matched: [], missing: [] };
  for (const r of (restrictions ?? []).map(normalizeRestriction).filter(Boolean)) {
    (tags.has(r) ? result.matched : result.missing).push(r);
  }
  return result;
}
