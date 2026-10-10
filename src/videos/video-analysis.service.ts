import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { NutritionService } from '../nutrition/nutrition.service';
import {
  IYouTubeService,
  YOUTUBE_SERVICE,
} from '../youtube/youtube.interface';
import { VideoAnalysis } from './analyzers/analysis.schema';
import {
  VIDEO_ANALYZER,
  VideoAnalyzer,
  VideoTarget,
} from './analyzers/video-analyzer.interface';
import { ANALYSIS_STORE, AnalysisStore } from './analysis-store';

export interface AnalysisResultWithCacheMeta {
  analysis: VideoAnalysis;
  fromCache: boolean;
}

@Injectable()
export class VideoAnalysisService {
  private readonly logger = new Logger(VideoAnalysisService.name);

  constructor(
    @Inject(ANALYSIS_STORE) private readonly cache: AnalysisStore,
    @Inject(VIDEO_ANALYZER) private readonly analyzer: VideoAnalyzer,
    private readonly config: AppConfigService,
    @Inject(YOUTUBE_SERVICE) private readonly youtube: IYouTubeService,
    @Optional() private readonly nutrition?: NutritionService,
  ) {}

  async analyzeWithMeta(
    target: VideoTarget,
  ): Promise<AnalysisResultWithCacheMeta> {
    const cached = await this.cache.get(
      target.videoId,
      this.analyzer.provider(),
      this.analyzer.model(),
    );
    if (cached) {
      return { analysis: await this.withNutrition(cached, false), fromCache: true };
    }

    const enriched = await this.withDetails(target);
    const result = await this.analyzer.analyze(enriched);
    return { analysis: await this.withNutrition(result, true), fromCache: false };
  }

  /**
   * Nutrients are derived from the ingredients, so cached analyses get them
   * (or a newer version) without another Gemini call. Stored only when
   * computed: a null from an FDC outage is retried next time.
   */
  private async withNutrition(analysis: VideoAnalysis, isNew: boolean): Promise<VideoAnalysis> {
    const updated = this.nutrition ? await this.nutrition.ensure(analysis) : analysis;
    const changed = updated !== analysis && updated.nutrition !== null;
    if (analysis.status === 'ok' && (isNew || changed)) {
      // An outage must not be cached as "no nutrients" on a fresh analysis either.
      const toStore = updated.nutrition === null ? analysis : updated;
      await this.cache.set(toStore, this.config.effectiveLlmMode);
    }
    return updated;
  }

  async analyze(target: VideoTarget): Promise<VideoAnalysis> {
    const { analysis } = await this.analyzeWithMeta(target);
    return analysis;
  }

  provider(): 'gemini' | 'mock' {
    return this.analyzer.provider();
  }

  model(): string {
    return this.analyzer.model();
  }

  /**
   * Fetch the description (and real title/channel) when the caller does not
   * have it. Costs 1 YouTube quota unit and runs only on a cache miss.
   */
  private async withDetails(target: VideoTarget): Promise<VideoTarget> {
    if (target.description !== undefined) return target;
    try {
      const [details] = await this.youtube.getDetails([target.videoId]);
      if (!details) return target;
      return {
        videoId: target.videoId,
        title: details.title || target.title,
        channel: details.channel || target.channel,
        channelId: details.channelId || target.channelId,
        description: details.description,
      };
    } catch (err) {
      this.logger.warn(
        `Could not fetch details for ${target.videoId}; analyzing without description: ${err}`,
      );
      return target;
    }
  }
}
