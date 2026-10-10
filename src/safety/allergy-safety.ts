import type { VideoAnalysis } from '../videos/analysis.schema';
import {
  SEVERE_ALLERGY_PATTERN,
  canonicalAllergensFor,
  findAllergyMatches,
  haystackMatchesAllergy,
} from '../videos/allergy.util';

export type SafetyStatus = 'safe' | 'uncertain' | 'unsafe';

export interface AllergySafetyVerdict {
  status: SafetyStatus;
  notes: string;
}

type AnalysisForSafety = Pick<
  VideoAnalysis,
  | 'status'
  | 'error'
  | 'provider'
  | 'recipeName'
  | 'ingredients'
  | 'steps'
  | 'allergens'
  | 'crossContactNotes'
  | 'sodiumSources'
  | 'summary'
  | 'coverage'
>;

/**
 * ALLERGY SAFETY — deterministic, safety-critical, never delegated to the LLM.
 *
 * | Condition                                                   | Verdict   |
 * |-------------------------------------------------------------|-----------|
 * | analysis unavailable                                        | uncertain |
 * | allergen finding (confirmed/likely) maps to a user allergy  | unsafe    |
 * | alias hit in recipe name / ingredients / steps / sodium src | unsafe    |
 * | allergen finding with confidence "possible"                 | uncertain |
 * | alias hit in cross-contact notes or summary                 | uncertain |
 * | partial coverage (or mock provider) + severe allergy        | uncertain |
 * | otherwise                                                   | safe      |
 *
 * Rules are evaluated most-severe first, so "unsafe" always wins.
 */
export function evaluateAllergySafety(
  analysis: AnalysisForSafety,
  allergiesInput: string[] | undefined,
): AllergySafetyVerdict {
  const allergies = (allergiesInput ?? []).map((a) => a.trim()).filter(Boolean);

  if (analysis.status !== 'ok') {
    return {
      status: 'uncertain',
      notes: `Video could not be analyzed (${analysis.error ?? 'unknown error'}); allergen content unknown.`,
    };
  }
  if (!allergies.length) {
    return {
      status: 'safe',
      notes: 'No allergies declared; always verify ingredients yourself.',
    };
  }

  const unsafe: string[] = [];
  const uncertain: string[] = [];

  // 1. Structured allergen findings.
  for (const allergy of allergies) {
    const canon = new Set(canonicalAllergensFor(allergy));
    for (const f of analysis.allergens) {
      const hit =
        canon.has(f.allergen as any) ||
        haystackMatchesAllergy(f.allergen.replace(/_/g, ' '), allergy);
      if (!hit) continue;
      const label = `${allergy} (${f.allergen}, ${f.confidence}${f.evidence ? `: ${truncate(f.evidence, 80)}` : ''})`;
      if (f.confidence === 'possible') uncertain.push(label);
      else unsafe.push(label);
    }
  }

  // 2. Alias hits in recipe content.
  const recipeHay = [
    analysis.recipeName,
    ...analysis.ingredients.map((i) => i.name),
    ...analysis.steps,
    ...analysis.sodiumSources,
  ].join(' \n ');
  for (const a of findAllergyMatches(recipeHay, allergies)) {
    unsafe.push(`${a} (mentioned in ingredients/steps)`);
  }

  if (unsafe.length) {
    return {
      status: 'unsafe',
      notes: `Detected allergen match: ${dedupe(unsafe).join('; ')}. Do not use this recipe.`,
    };
  }

  // 3. Softer signals.
  for (const a of findAllergyMatches(analysis.crossContactNotes.join(' \n '), allergies)) {
    uncertain.push(`${a} (cross-contact note)`);
  }
  for (const a of findAllergyMatches(analysis.summary, allergies)) {
    uncertain.push(`${a} (mentioned in summary)`);
  }
  if (uncertain.length) {
    return {
      status: 'uncertain',
      notes: `Possible allergen exposure: ${dedupe(uncertain).join('; ')}. Review the full video/recipe before cooking.`,
    };
  }

  const severe = allergies.filter((a) => SEVERE_ALLERGY_PATTERN.test(a));
  if (severe.length && (analysis.coverage === 'partial' || analysis.provider === 'mock')) {
    const why =
      analysis.provider === 'mock'
        ? 'offline mock analysis only looked at the title'
        : 'the analysis could not see/hear the whole recipe';
    return {
      status: 'uncertain',
      notes: `Cannot confirm absence of ${severe.join(', ')}: ${why}. Review the full video/recipe before cooking.`,
    };
  }

  return {
    status: 'safe',
    notes: `No match for declared allergies (${allergies.join(', ')}) in the analyzed recipe. Still verify the full recipe — analysis may be incomplete.`,
  };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
