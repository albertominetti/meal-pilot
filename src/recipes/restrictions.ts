import { normalizeToken } from '../videos/allergy.util';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';

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

export function restrictionCoverage(
  analysis: Pick<VideoAnalysis, 'restrictionTags' | 'nutritionSignals'>,
  restrictions: string[] | undefined,
): RestrictionCoverage {
  const tags = new Set<string>();
  for (const t of [...(analysis.restrictionTags ?? []), ...(analysis.nutritionSignals ?? [])]) {
    tags.add(t);
    for (const implied of IMPLIES[t] ?? []) tags.add(implied);
  }
  const result: RestrictionCoverage = { matched: [], missing: [] };
  for (const r of (restrictions ?? []).map(normalizeRestriction).filter(Boolean)) {
    (tags.has(r) ? result.matched : result.missing).push(r);
  }
  return result;
}
