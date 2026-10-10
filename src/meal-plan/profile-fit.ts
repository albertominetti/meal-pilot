import type { VideoAnalysis } from '../videos/analysis.schema';
import { normalizeToken } from '../videos/allergy.util';
import type { MealPlanRequestDto } from './dto/meal-plan-request.dto';

export const KNOWN_RESTRICTION_TAGS = [
  'vegan',
  'vegetarian',
  'pescatarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'egg-free',
  'low-sodium',
  'low-carb',
  'high-protein',
  'high-fiber',
  'halal',
  'kosher',
];

export function normalizeRestriction(r: string): string {
  return normalizeToken(r).replace(/\s+/g, '-');
}

export interface NormalizedProfile {
  allergies: string[];
  restrictions: string[];
  healthText: string;
  maxResults: number;
}

export function normalizeProfile(dto: MealPlanRequestDto): NormalizedProfile {
  return {
    allergies: (dto.allergies ?? []).map((a) => a.trim()).filter(Boolean),
    restrictions: (dto.restrictions ?? []).map(normalizeRestriction).filter(Boolean),
    healthText: `${dto.healthProfile ?? ''} ${dto.preferences ?? ''} ${dto.bloodPressure ?? ''}`.toLowerCase(),
    maxResults: dto.maxResults ?? 5,
  };
}

/** True when the profile suggests sodium restriction (hypertension etc.). */
export function needsLowSodium(healthText: string, bloodPressure?: string): boolean {
  if (/hypertension|high blood pressure|low.?sodium|low.?salt/.test(healthText)) return true;
  const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(bloodPressure ?? healthText);
  if (m) {
    const sys = parseInt(m[1], 10);
    const dia = parseInt(m[2], 10);
    return sys >= 130 || dia >= 80;
  }
  return false;
}

/** Deterministic tag matching between analysis and profile. */
export function matchTags(
  analyzed: Pick<VideoAnalysis, 'restrictionTags' | 'nutritionSignals'>,
  restrictions: string[],
  healthText: string,
): string[] {
  const tags = new Set<string>();
  const known = new Set(
    [...analyzed.restrictionTags, ...analyzed.nutritionSignals].map(normalizeRestriction),
  );
  for (const r of restrictions) {
    if (known.has(r)) tags.add(r);
    else if (r === 'vegetarian' && known.has('vegan')) tags.add('vegan');
  }
  for (const t of KNOWN_RESTRICTION_TAGS) {
    if (known.has(t)) tags.add(t);
  }
  if (needsLowSodium(healthText) && known.has('low-sodium')) tags.add('low-sodium');
  if (/diabet/.test(healthText) && known.has('low-carb')) tags.add('low-carb');
  return [...tags];
}

/** Requested restrictions that the analysis does NOT confirm. */
export function restrictionGaps(
  analyzed: Pick<VideoAnalysis, 'restrictionTags' | 'nutritionSignals'>,
  restrictions: string[],
): string[] {
  const known = new Set(
    [...analyzed.restrictionTags, ...analyzed.nutritionSignals].map(normalizeRestriction),
  );
  return restrictions.filter(
    (r) => !known.has(r) && !(r === 'vegetarian' && known.has('vegan')),
  );
}

/** Health-related warnings derived from the analysis (sodium, frying...). */
export function healthWarnings(
  analyzed: Pick<VideoAnalysis, 'nutritionSignals' | 'sodiumSources'>,
  dto: Pick<MealPlanRequestDto, 'healthProfile' | 'preferences' | 'bloodPressure'>,
): string[] {
  const healthText = `${dto.healthProfile ?? ''} ${dto.preferences ?? ''}`.toLowerCase();
  const out: string[] = [];
  if (needsLowSodium(healthText, dto.bloodPressure)) {
    if (analyzed.nutritionSignals.includes('high-sodium')) out.push('Recipe is high in sodium.');
    if (analyzed.sodiumSources.length) {
      out.push(`Sodium sources to reduce or swap: ${analyzed.sodiumSources.join(', ')}.`);
    }
  }
  if (/diabet/.test(healthText) && !analyzed.nutritionSignals.includes('low-carb')) {
    out.push('Not tagged low-carb; watch portion size of starchy components.');
  }
  if (analyzed.nutritionSignals.includes('deep-fried')) out.push('Involves deep frying.');
  return out;
}

export function explainFit(
  analyzed: Pick<VideoAnalysis, 'title' | 'summary'>,
  restrictions: string[],
  dto: MealPlanRequestDto,
  matchedTags: string[],
): string {
  const bits: string[] = [];
  bits.push(`"${analyzed.title}": ${analyzed.summary}`);
  if (restrictions.length) {
    bits.push(
      `Requested restrictions (${restrictions.join(', ')}) overlap with tags: ${matchedTags.join(', ') || 'none explicitly tagged — review recipe'}.`,
    );
  }
  if (dto.bloodPressure) {
    bits.push(`Blood pressure noted as ${dto.bloodPressure}; prefer low-sodium preparations and confirm with a professional.`);
  }
  if (dto.healthProfile) bits.push(`Health context: ${dto.healthProfile}.`);
  return bits.join(' ');
}

export function healthNotes(
  analyzed: Pick<VideoAnalysis, 'nutritionSignals' | 'sodiumSources'>,
  dto: MealPlanRequestDto,
): string {
  const signals = analyzed.nutritionSignals.join(', ') || 'no nutrition signals extracted';
  const warnings = healthWarnings(analyzed, dto);
  return [
    `Signals: ${signals}.`,
    ...warnings,
    `Profile: ${dto.healthProfile ?? 'not provided'}; BP: ${dto.bloodPressure ?? 'not provided'}. Informational only — not medical advice.`,
  ].join(' ');
}

/** A reasonable YouTube search query derived from the profile (used when no candidates are given). */
export function defaultSearchQuery(dto: MealPlanRequestDto): string {
  const p = normalizeProfile(dto);
  const parts = p.restrictions.map((r) => r.replace(/-/g, ' '));
  if (needsLowSodium(p.healthText, dto.bloodPressure)) parts.push('low sodium');
  if (/diabet/.test(p.healthText)) parts.push('low carb');
  if (dto.preferences) parts.push(dto.preferences.slice(0, 60));
  parts.push('healthy recipe');
  return [...new Set(parts)].join(' ');
}
