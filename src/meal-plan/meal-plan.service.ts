import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { evaluateAllergySafety } from '../safety/allergy-safety';
import { VideoAnalysis, VideoRef } from '../videos/analysis.schema';
import { TranscriptCacheService } from '../videos/transcript-cache.service';
import { VideoAnalysisService } from '../videos/video-analysis.service';
import { extractVideoId, watchUrl } from '../videos/youtube.util';
import { YouTubeClient, YouTubeError } from '../youtube/youtube.service';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import {
  ExcludedVideoDto,
  MEDICAL_DISCLAIMER,
  MealPlanResponseDto,
  RecommendationDto,
} from './dto/meal-plan-response.dto';
import { defaultSearchQuery, explainFit, healthNotes, matchTags, normalizeProfile } from './profile-fit';

/**
 * Deterministic pipeline: candidates -> (YouTube metadata) -> analysis ->
 * allergy verdict -> tag matching -> template explanations.
 * The agent (`/meal-plan/agent`) reuses its building blocks and uses it as
 * the fallback planner.
 */
@Injectable()
export class MealPlanService {
  private readonly logger = new Logger(MealPlanService.name);

  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly analysis: VideoAnalysisService,
    private readonly config: AppConfig,
    @Optional() private readonly youtube?: YouTubeClient,
  ) {}

  async buildPlan(dto: MealPlanRequestDto): Promise<MealPlanResponseDto> {
    const { candidates, excluded } = await this.resolveCandidates(dto);
    return this.buildPlanFrom(dto, candidates, excluded);
  }

  /** Analyze the given candidates in order until maxResults safe matches are found. */
  async buildPlanFrom(
    dto: MealPlanRequestDto,
    candidates: VideoRef[],
    excluded: ExcludedVideoDto[] = [],
  ): Promise<MealPlanResponseDto> {
    const started = Date.now();
    const profile = normalizeProfile(dto);

    const recommendations: RecommendationDto[] = [];
    const failures: { videoId: string; error: string }[] = [];
    let analyzed = 0;
    let fromCache = 0;
    const batch = this.config.analysisConcurrency;

    for (let i = 0; i < candidates.length && recommendations.length < profile.maxResults; i += batch) {
      const outcomes = await this.analysis.analyzeMany(candidates.slice(i, i + batch));
      for (const { analysis: a, fromCache: hit } of outcomes) {
        analyzed++;
        if (hit) fromCache++;
        if (a.status !== 'ok') failures.push({ videoId: a.videoId, error: a.error ?? 'unknown' });
        if (recommendations.length >= profile.maxResults) continue;
        const r = this.evaluate(a, dto);
        if ('reason' in r) excluded.push(r);
        else recommendations.push(r);
      }
    }

    return {
      recommendations,
      excluded,
      disclaimer: MEDICAL_DISCLAIMER,
      meta: {
        mode: this.config.llmMode,
        provider: this.analysis.provider(),
        model: this.analysis.model(),
        analyzed,
        fromCache,
        failures,
        durationMs: Date.now() - started,
      },
    };
  }

  /** Turn one analysis into a recommendation or an exclusion. */
  evaluate(a: VideoAnalysis, dto: MealPlanRequestDto): RecommendationDto | ExcludedVideoDto {
    const profile = normalizeProfile(dto);
    const verdict = evaluateAllergySafety(a, profile.allergies);
    if (verdict.status !== 'safe') {
      return {
        videoId: a.videoId,
        url: watchUrl(a.videoId),
        title: a.title,
        reason: verdict.status === 'unsafe' ? `Blocked: ${verdict.notes}` : `Needs review: ${verdict.notes}`,
      };
    }
    const matchedTags = matchTags(a, profile.restrictions, profile.healthText);
    return {
      videoId: a.videoId,
      url: watchUrl(a.videoId),
      title: a.title,
      channel: a.channel,
      whyItFits: explainFit(a, profile.restrictions, dto, matchedTags),
      matchedTags,
      allergySafety: verdict,
      healthNotes: healthNotes(a, dto),
      provider: a.provider,
    };
  }

  async resolveCandidates(dto: MealPlanRequestDto): Promise<{ candidates: VideoRef[]; excluded: ExcludedVideoDto[] }> {
    const excluded: ExcludedVideoDto[] = [];
    const fromRequest: VideoRef[] = [];
    const seen = new Set<string>();
    for (const v of dto.videoCandidates ?? []) {
      const id = extractVideoId(v.idOrUrl);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fromRequest.push({
        videoId: id,
        title: v.title?.trim() || `YouTube video ${id}`,
        channel: v.channel?.trim() || 'Unknown channel',
      });
    }
    if (fromRequest.length === 0) {
      if (this.config.llmMode === 'mock') {
        // Demo fallback: committed seed list (fake ids, only meaningful for the mock analyzer).
        return { candidates: this.cache.loadSeed(), excluded };
      }
      if (this.youtube?.isEnabled()) {
        const found = await this.youtube.search(defaultSearchQuery(dto), { maxResults: 10 }).catch((err) => {
          if (err instanceof YouTubeError) throw new ServiceUnavailableException(`YouTube search failed: ${err.code}`);
          throw err;
        });
        return {
          candidates: found.map((d) => ({ videoId: d.videoId, title: d.title, channel: d.channel, durationSec: d.durationSec })),
          excluded,
        };
      }
      throw new BadRequestException(
        'Provide videoCandidates, or configure YOUTUBE_API_KEY so candidates can be searched (or use /api/meal-plan/agent).',
      );
    }
    return this.enrich(fromRequest, excluded);
  }

  /** Replace caller-supplied titles with real YouTube metadata; drop non-public videos. */
  async enrich(refs: VideoRef[], excluded: ExcludedVideoDto[] = []) {
    if (!this.youtube?.isEnabled()) return { candidates: refs, excluded };
    try {
      const details = await this.youtube.getDetails(refs.map((r) => r.videoId));
      const candidates: VideoRef[] = [];
      for (const r of refs) {
        const d = details.get(r.videoId);
        if (!d || d.privacyStatus !== 'public') {
          excluded.push({
            videoId: r.videoId,
            url: watchUrl(r.videoId),
            title: d?.title ?? r.title,
            reason: `Needs review: video not found or not public (${d?.privacyStatus ?? 'not found'}); it cannot be analyzed.`,
          });
          continue;
        }
        candidates.push({ videoId: r.videoId, title: d.title, channel: d.channel, durationSec: d.durationSec });
      }
      return { candidates, excluded };
    } catch (err) {
      this.logger.warn(`YouTube metadata lookup failed, using request metadata: ${err}`);
      return { candidates: refs, excluded };
    }
  }
}
