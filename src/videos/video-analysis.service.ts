import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { VideoAnalysis } from './analyzers/analysis.schema';
import {
  VIDEO_ANALYZER,
  VideoAnalyzer,
} from './analyzers/video-analyzer.interface';
import { TranscriptCacheService } from './transcript-cache.service';

export interface AnalysisResultWithCacheMeta {
  analysis: VideoAnalysis;
  fromCache: boolean;
}

@Injectable()
export class VideoAnalysisService {
  constructor(
    private readonly cache: TranscriptCacheService,
    @Inject(VIDEO_ANALYZER) private readonly analyzer: VideoAnalyzer,
    private readonly config: AppConfigService,
  ) {}

  async analyzeWithMeta(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<AnalysisResultWithCacheMeta> {
    const cached = this.cache.get(
      videoId,
      this.analyzer.provider(),
      this.analyzer.model(),
    );
    if (cached) {
      return { analysis: cached, fromCache: true };
    }

    const result = await this.analyzer.analyze({ videoId, title, channel });
    if (result.status === 'ok') {
      this.cache.set(result, this.config.effectiveLlmMode);
    }

    return { analysis: result, fromCache: false };
  }

  async analyze(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<VideoAnalysis> {
    const { analysis } = await this.analyzeWithMeta(videoId, title, channel);
    return analysis;
  }

  provider(): 'gemini' | 'mock' {
    return this.analyzer.provider();
  }

  model(): string {
    return this.analyzer.model();
  }
}
