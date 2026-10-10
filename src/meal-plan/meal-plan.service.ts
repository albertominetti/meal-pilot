import { Injectable } from '@nestjs/common';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import {
  ExcludedVideoDto,
  MEDICAL_DISCLAIMER,
  RecommendationDto,
} from './dto/meal-plan-response.dto';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { extractVideoId, watchUrl } from '../videos/youtube.util';
import { findAllergyMatches, normalizeToken } from '../videos/allergy.util';

interface Candidate {
  videoId: string;
  title: string;
  channel: string;
}

const KNOWN_RESTRICTION_TAGS = [
  'vegan',
  'vegetarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'low-sodium',
  'low-carb',
  'high-protein',
  'halal',
  'kosher',
];

function normalizeRestriction(r: string): string {
  return normalizeToken(r).replace(/\s+/g, '-');
}

@Injectable()
export class MealPlanService {
  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly analysis: VideoAnalysisService,
  ) {}

  async buildPlan(dto: MealPlanRequestDto): Promise<{
    recommendations: RecommendationDto[];
    excluded: ExcludedVideoDto[];
    disclaimer: string;
  }> {
    const candidates = this.resolveCandidates(dto);
    const max = dto.maxResults ?? 5;
    const allergies = (dto.allergies ?? []).map((a) => a.trim()).filter(Boolean);
    const restrictions = (dto.restrictions ?? []).map(normalizeRestriction).filter(Boolean);
    const healthText = `${dto.healthProfile ?? ''} ${dto.preferences ?? ''} ${dto.bloodPressure ?? ''}`.toLowerCase();

    const recommendations: RecommendationDto[] = [];
    const excluded: ExcludedVideoDto[] = [];

    for (const c of candidates) {
      if (recommendations.length >= max) break;
      const analyzed = await this.analysis.analyze(c.videoId, c.title, c.channel);
      const verdict = this.evaluateAllergySafety(analyzed, allergies);

      if (verdict.status !== 'safe') {
        excluded.push({
          videoId: c.videoId,
          url: watchUrl(c.videoId),
          title: analyzed.title,
          reason:
            verdict.status === 'unsafe'
              ? `Blocked: ${verdict.notes}`
              : `Needs review: ${verdict.notes}`,
        });
        continue;
      }

      const matchedTags = this.matchTags(analyzed, restrictions, healthText);
      recommendations.push({
        videoId: c.videoId,
        url: watchUrl(c.videoId),
        title: analyzed.title,
        channel: analyzed.channel,
        whyItFits: this.explainFit(analyzed, restrictions, dto, matchedTags),
        matchedTags,
        allergySafety: verdict,
        healthNotes: this.healthNotes(analyzed, dto),
      });
    }

    return { recommendations, excluded, disclaimer: MEDICAL_DISCLAIMER };
  }

  private resolveCandidates(dto: MealPlanRequestDto): Candidate[] {
    const fromRequest: Candidate[] = [];
    for (const v of dto.videoCandidates ?? []) {
      const id = extractVideoId(v.idOrUrl);
      if (!id) continue;
      fromRequest.push({
        videoId: id,
        title: v.title?.trim() || `YouTube video ${id}`,
        channel: v.channel?.trim() || 'Unknown channel',
      });
    }
    if (fromRequest.length > 0) return fromRequest;
    // Demo fallback: committed seed list.
    return this.cache.loadSeed().map((s) => ({
      videoId: s.videoId,
      title: s.title,
      channel: s.channel,
    }));
  }

  /**
   * ALLERGY SAFETY (critical path):
   * - Any detected-allergen match against the user's allergy list -> unsafe.
   * - Any ingredient/transcript mention of an allergy -> unsafe (conservative).
   * - "Free-from" uncertainty for severe allergens (peanut/shellfish/etc.)
   *   without explicit evidence -> uncertain (excluded from recommendations).
   */
  evaluateAllergySafety(
    analyzed: { ingredients: string[]; detectedAllergens: string[]; transcript: string },
    allergies: string[],
  ): { status: 'safe' | 'uncertain' | 'unsafe'; notes: string } {
    if (!allergies.length) {
      return {
        status: 'safe',
        notes: 'No allergies declared; always verify ingredients yourself.',
      };
    }
    const ingredientHay = analyzed.ingredients.join(' ');
    const allergenHay = analyzed.detectedAllergens.join(' ');
    const combined = `${ingredientHay} ${allergenHay} ${analyzed.transcript}`;

    const direct = findAllergyMatches(`${ingredientHay} ${allergenHay}`, allergies);
    if (direct.length > 0) {
      return {
        status: 'unsafe',
        notes: `Detected allergen match (${direct.join(', ')}) in analyzed ingredients/allergens. Do not use this recipe.`,
      };
    }
    const transcriptHits = findAllergyMatches(analyzed.transcript, allergies);
    if (transcriptHits.length > 0) {
      return {
        status: 'unsafe',
        notes: `Allergen mention (${transcriptHits.join(', ')}) found in video transcript/summary. Treated as unsafe.`,
      };
    }
    // Uncertain: mock/offline provider cannot prove absence of cross-contact.
    if ((analyzed as { provider?: string }).provider === 'mock') {
      const severe = allergies.filter((a) =>
        /peanut|tree.?nut|almond|walnut|cashew|shellfish|shrimp|fish|sesame|milk|egg|soy/i.test(a),
      );
      if (severe.length > 0 && /no common allergens detected/i.test(analyzed.transcript)) {
        return {
          status: 'uncertain',
          notes: `Offline mock analysis cannot confirm absence of ${severe.join(', ')} (cross-contact unknown). Review the full video/recipe before cooking.`,
        };
      }
    }
    void combined;
    return {
      status: 'safe',
      notes: `No match for declared allergies (${allergies.join(', ')}) in analyzed data. Still verify the full recipe — analysis may be incomplete.`,
    };
  }

  private matchTags(
    analyzed: { restrictionTags: string[]; nutritionSignals: string[] },
    restrictions: string[],
    healthText: string,
  ): string[] {
    const tags = new Set<string>();
    const known = new Set(
      [...analyzed.restrictionTags, ...analyzed.nutritionSignals].map(normalizeRestriction),
    );
    for (const r of restrictions) {
      if (known.has(r)) {
        tags.add(r);
        continue;
      }
      // vegan implies vegetarian; gluten-free variants.
      if (r === 'vegetarian' && known.has('vegan')) tags.add('vegan');
      if (r === 'gluten-free' && known.has('gluten-free')) tags.add('gluten-free');
    }
    for (const t of KNOWN_RESTRICTION_TAGS) {
      if (known.has(t)) tags.add(t);
    }
    if (/hypertension|high blood pressure|low sodium|140\/|150\//.test(healthText)) {
      if (known.has('low-sodium')) tags.add('low-sodium');
    }
    if (/diabet/.test(healthText) && known.has('low-carb')) tags.add('low-carb');
    return [...tags];
  }

  private explainFit(
    analyzed: { title: string; summary: string },
    restrictions: string[],
    dto: MealPlanRequestDto,
    matchedTags: string[],
  ): string {
    const bits: string[] = [];
    bits.push(`"${analyzed.title}" fits because ${analyzed.summary}`);
    if (restrictions.length) {
      bits.push(`Requested restrictions (${restrictions.join(', ')}) overlap with tags: ${matchedTags.join(', ') || 'none explicitly tagged — review recipe'}.`);
    }
    if (dto.bloodPressure) bits.push(`Blood pressure noted as ${dto.bloodPressure}; prefer low-sodium preparations and confirm with a professional.`);
    if (dto.healthProfile) bits.push(`Health context: ${dto.healthProfile}.`);
    return bits.join(' ');
  }

  private healthNotes(
    analyzed: { nutritionSignals: string[] },
    dto: MealPlanRequestDto,
  ): string {
    const signals = analyzed.nutritionSignals.join(', ') || 'no nutrition signals extracted';
    return `Signals: ${signals}. Profile: ${dto.healthProfile ?? 'not provided'}; BP: ${dto.bloodPressure ?? 'not provided'}. Informational only — not medical advice.`;
  }
}
