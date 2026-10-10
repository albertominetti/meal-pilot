import { Injectable } from '@nestjs/common';
import {
  CachedAnalysis,
  TranscriptCacheService,
} from './transcript-cache.service';
import { GeminiService } from './gemini.service';

/**
 * Orchestrates cache lookup -> Gemini/mock analysis -> cached persistence.
 */
@Injectable()
export class VideoAnalysisService {
  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly gemini: GeminiService,
  ) {}

  async analyze(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<CachedAnalysis> {
    const cached = this.cache.get(videoId);
    if (cached) return cached;
    const result = await this.gemini.analyzeVideo(videoId, title, channel);
    return this.cache.set({
      ...result,
      videoId,
      analyzedAt: new Date().toISOString(),
    });
  }

  provider(): 'gemini' | 'mock' {
    return this.gemini.provider();
  }
}
