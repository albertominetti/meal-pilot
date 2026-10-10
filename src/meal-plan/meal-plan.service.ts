import { BadRequestException, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  excludedForSafety,
  ExcludedVideoDto,
  excludedVideo,
  FailureDetailDto,
  MealPlanMetaDto,
  MealPlanResponseDto,
  MEDICAL_DISCLAIMER,
  RecommendationDto,
} from './dto/meal-plan-response.dto';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { selectRanked } from '../recipes/ranking';
import { normalizeRestriction } from '../recipes/restrictions';
import { TrustedChannelsService } from '../youtube/trusted-channels.service';
import { buildRecommendation } from './recommendation.builder';
import {
  findAllergyMatches,
  haystackMatchesAllergy,
  mapToCanonicalAllergens,
} from '../videos/allergy.util';
import { checkTime, matchGoals } from './profile-fit';

type SafetyVerdict = { status: 'safe' | 'uncertain' | 'unsafe'; notes: string };

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

@Injectable()
export class MealPlanService {
  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly analysis: VideoAnalysisService,
    private readonly config: AppConfigService,
    private readonly trustedChannels: TrustedChannelsService,
  ) {}

  async buildPlan(dto: MealPlanRequestDto): Promise<MealPlanResponseDto> {
    const candidates = await this.resolveCandidates();
    const min = dto.minResults ?? 1;
    const max = dto.maxResults ?? 5;
    if (max < min) {
      throw new BadRequestException(
        'maxResults must be greater than or equal to minResults',
      );
    }
    const allergies = (dto.allergies ?? []).map((a) => a.trim()).filter(Boolean);
    const restrictions = (dto.restrictions ?? [])
      .map(normalizeRestriction)
      .filter(Boolean);
    const healthText = `${dto.healthProfile ?? ''} ${dto.preferences ?? ''} ${dto.bloodPressure ?? ''}`.toLowerCase();

    const excluded: ExcludedVideoDto[] = [];
    const failures: FailureDetailDto[] = [];
    const eligible: Array<{ analysis: VideoAnalysis; verdict: SafetyVerdict }> = [];

    let analyzedCount = 0;
    let fromCacheCount = 0;

    // Analyse every candidate (cached analyses are free), gate on safety and
    // time, then rank the rest so the best recipes win, not the first ones.
    const concurrency = Math.max(1, this.config.analysisConcurrency || 3);
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((c) =>
          this.analysis.analyzeWithMeta({
            videoId: c.videoId,
            title: c.title,
            channel: c.channel,
          }),
        ),
      );

      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const { analysis: analyzed, fromCache } = batchResults[j];

        if (fromCache) {
          fromCacheCount++;
        } else {
          analyzedCount++;
        }

        if (analyzed.status === 'unavailable') {
          const reason = analyzed.error || 'Video analysis unavailable';
          failures.push({ videoId: c.videoId, reason });
          excluded.push(excludedVideo(c.videoId, analyzed.title, 'unavailable', reason));
          continue;
        }

        const verdict = this.evaluateAllergySafety(analyzed, allergies);
        if (verdict.status !== 'safe') {
          excluded.push(excludedForSafety(c.videoId, analyzed.title, verdict));
          continue;
        }

        const time = checkTime(analyzed, dto.maxCookMinutes);
        if (time.fitsTime === false) {
          excluded.push(excludedVideo(c.videoId, analyzed.title, 'too_long', time.note!));
          continue;
        }

        eligible.push({ analysis: analyzed, verdict });
      }
    }

    const isTrusted = (id: string | undefined) => this.trustedChannels.isTrusted(id);
    const ranked = selectRanked(
      eligible.map((e) => e.analysis),
      { restrictions: dto.restrictions, healthGoals: dto.healthGoals, maxCookMinutes: dto.maxCookMinutes, isTrusted },
      max,
    );

    const recommendations: RecommendationDto[] = ranked.map(({ analysis: analyzed }) => {
      const verdict = eligible.find((e) => e.analysis === analyzed)!.verdict;
      const time = checkTime(analyzed, dto.maxCookMinutes);
      const goals = matchGoals(analyzed, dto.healthGoals);
      const matchedTags = [
        ...new Set([...this.matchTags(analyzed, restrictions, healthText), ...goals.matched]),
      ];
      return buildRecommendation({
        analysis: analyzed,
        verdict,
        whyItFits: this.explainFit(analyzed, restrictions, dto, matchedTags),
        matchedTags,
        healthNotes: [
          this.healthNotes(analyzed, dto),
          time.note,
          goals.unverifiable.length
            ? `Goals not yet checkable from the recipe: ${goals.unverifiable.join(', ')}.`
            : undefined,
        ]
          .filter(Boolean)
          .join(' '),
        request: dto,
        trusted: isTrusted(analyzed.channelId),
      });
    });

    const meta: MealPlanMetaDto = {
      mode: this.config.effectiveLlmMode,
      provider: this.analysis.provider(),
      model: this.analysis.model(),
      analyzed: analyzedCount,
      fromCache: fromCacheCount,
      failures,
    };

    return {
      recommendations,
      excluded,
      disclaimer: MEDICAL_DISCLAIMER,
      meta,
    };
  }

  private async resolveCandidates(): Promise<Candidate[]> {
    return this.cache.loadSeed().map((s) => ({
      videoId: s.videoId,
      title: s.title,
      channel: s.channel,
    }));
  }

  /**
   * ALLERGY SAFETY (table-driven safety rules):
   * 1. If analysis is unavailable -> uncertain (excluded from recommendations).
   * 2. Any matching allergen with confirmed or likely confidence -> unsafe.
   * 3. Matching allergen with possible confidence, or matched in crossContactNotes -> uncertain.
   * 4. Alias hit in ingredients or steps text -> unsafe.
   * 5. coverage: partial and user has severe allergies -> uncertain.
   * 6. Offline mock analysis cannot prove absence of severe allergens -> uncertain.
   * 7. Otherwise -> safe (with "verify recipe" note).
   */
  evaluateAllergySafety(
    analyzed: Partial<VideoAnalysis> & {
      ingredients?: Array<string | { name: string; rawText?: string }>;
      detectedAllergens?: string[];
      transcript?: string;
    },
    allergies: string[],
  ): { status: 'safe' | 'uncertain' | 'unsafe'; notes: string } {
    if (analyzed.status === 'unavailable') {
      return {
        status: 'uncertain',
        notes: `Analysis unavailable (${analyzed.error || 'unprocessed'}). Excluded as uncertain to prevent unsafe assumptions.`,
      };
    }

    if (!allergies.length) {
      return {
        status: 'safe',
        notes: 'No allergies declared; always verify ingredients yourself.',
      };
    }

    // Map user allergies to canonical EU 14 allergens
    const userCanonical = new Set<string>();
    for (const a of allergies) {
      for (const c of mapToCanonicalAllergens(a)) {
        userCanonical.add(c);
      }
    }

    // 2 & 3: Check structured allergen evidence
    if (analyzed.allergens && analyzed.allergens.length > 0) {
      for (const evidence of analyzed.allergens) {
        const isMatched =
          userCanonical.has(evidence.allergen) ||
          allergies.some((a) => haystackMatchesAllergy(evidence.allergen, a));

        if (isMatched) {
          if (
            evidence.confidence === 'confirmed' ||
            evidence.confidence === 'likely'
          ) {
            return {
              status: 'unsafe',
              notes: `Detected allergen ${evidence.allergen} (${evidence.confidence}): ${evidence.evidence}. Do not use this recipe.`,
            };
          }
          if (evidence.confidence === 'possible') {
            return {
              status: 'uncertain',
              notes: `Possible allergen ${evidence.allergen}: ${evidence.evidence}. Excluded as uncertain.`,
            };
          }
        }
      }
    }

    // 3: Check cross-contact notes
    if (analyzed.crossContactNotes && analyzed.crossContactNotes.length > 0) {
      for (const note of analyzed.crossContactNotes) {
        const crossMatches = findAllergyMatches(note, allergies);
        if (crossMatches.length > 0) {
          return {
            status: 'uncertain',
            notes: `Cross-contact risk noted for ${crossMatches.join(', ')}: "${note}". Excluded as uncertain.`,
          };
        }
      }
    }

    // 4: Direct alias check in ingredients (normalised name and raw text as
    // said or written, e.g. "peanut satay sauce") and steps
    const rawIngredients = (analyzed.ingredients ?? [])
      .map((i) => (typeof i === 'string' ? i : `${i.name} ${i.rawText ?? ''}`))
      .join(' ; ');
    const rawSteps = (analyzed.steps ?? []).join(' ');
    const detectedAllergensHay = (analyzed.detectedAllergens ?? []).join(' ');

    const directMatches = findAllergyMatches(
      `${rawIngredients} ${rawSteps} ${detectedAllergensHay}`,
      allergies,
    );
    if (directMatches.length > 0) {
      return {
        status: 'unsafe',
        notes: `Detected allergen match (${directMatches.join(', ')}) in analyzed ingredients/steps. Do not use this recipe.`,
      };
    }

    // Check transcript if present
    if (analyzed.transcript) {
      const transcriptMatches = findAllergyMatches(analyzed.transcript, allergies);
      if (transcriptMatches.length > 0) {
        return {
          status: 'unsafe',
          notes: `Allergen mention (${transcriptMatches.join(', ')}) found in video transcript/summary. Treated as unsafe.`,
        };
      }
    }

    const severeAllergies = allergies.filter((a) =>
      /peanut|tree.?nut|almond|walnut|cashew|shellfish|shrimp|fish|sesame|milk|egg|soy/i.test(
        a,
      ),
    );

    // 5: Partial coverage with severe allergies
    if (analyzed.coverage === 'partial' && severeAllergies.length > 0) {
      return {
        status: 'uncertain',
        notes: `Video coverage was only partial and user declared severe allergies (${severeAllergies.join(', ')}). Excluded as uncertain.`,
      };
    }

    // 6: Offline mock analysis cannot confirm absence of severe allergens
    if (
      analyzed.provider === 'mock' &&
      severeAllergies.length > 0 &&
      analyzed.transcript &&
      /no common allergens detected/i.test(analyzed.transcript)
    ) {
      return {
        status: 'uncertain',
        notes: `Offline mock analysis cannot confirm absence of ${severeAllergies.join(', ')} (cross-contact unknown). Review the full video/recipe before cooking.`,
      };
    }

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
      [...analyzed.restrictionTags, ...analyzed.nutritionSignals].map(
        normalizeRestriction,
      ),
    );

    for (const r of restrictions) {
      if (known.has(r)) {
        tags.add(r);
        continue;
      }
      if (r === 'vegetarian' && known.has('vegan')) tags.add('vegan');
      if (r === 'gluten-free' && known.has('gluten-free')) tags.add('gluten-free');
    }

    for (const t of KNOWN_RESTRICTION_TAGS) {
      if (known.has(t)) tags.add(t);
    }

    if (
      /hypertension|high blood pressure|low sodium|140\/|150\//.test(healthText)
    ) {
      if (known.has('low-sodium')) tags.add('low-sodium');
    }
    if (/diabet/.test(healthText) && known.has('low-carb')) {
      tags.add('low-carb');
    }

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
      bits.push(
        `Requested restrictions (${restrictions.join(', ')}) overlap with tags: ${matchedTags.join(', ') || 'none explicitly tagged — review recipe'}.`,
      );
    }
    if (dto.bloodPressure) {
      bits.push(
        `Blood pressure noted as ${dto.bloodPressure}; prefer low-sodium preparations and confirm with a professional.`,
      );
    }
    if (dto.healthProfile) {
      bits.push(`Health context: ${dto.healthProfile}.`);
    }
    return bits.join(' ');
  }

  private healthNotes(
    analyzed: { nutritionSignals: string[] },
    dto: MealPlanRequestDto,
  ): string {
    const signals =
      analyzed.nutritionSignals.join(', ') || 'no nutrition signals extracted';
    return `Estimated signals (model, not measured): ${signals}. Profile: ${dto.healthProfile ?? 'not provided'}; BP: ${dto.bloodPressure ?? 'not provided'}. Informational only — not medical advice.`;
  }
}
