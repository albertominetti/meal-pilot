import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
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
import { TranscriptCacheService } from './transcript-cache.service';

export interface AnalysisResultWithCacheMeta {
  analysis: VideoAnalysis;
  fromCache: boolean;
}

@Injectable()
export class VideoAnalysisService {
  private readonly logger = new Logger(VideoAnalysisService.name);

  constructor(
    private readonly cache: TranscriptCacheService,
    @Inject(VIDEO_ANALYZER) private readonly analyzer: VideoAnalyzer,
    private readonly config: AppConfigService,
    @Inject(YOUTUBE_SERVICE) private readonly youtube: IYouTubeService,
  ) {}

  async analyzeWithMeta(
    target: VideoTarget,
  ): Promise<AnalysisResultWithCacheMeta> {
    const cached = this.cache.get(
      target.videoId,
      this.analyzer.provider(),
      this.analyzer.model(),
    );
    if (cached) {
      return { analysis: cached, fromCache: true };
    }

    const enriched = await this.withDetails(target);
    const result = await this.analyzer.analyze(enriched);
    if (result.status === 'ok') {
      this.cache.set(result, this.config.effectiveLlmMode);
    }

    return { analysis: result, fromCache: false };
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
