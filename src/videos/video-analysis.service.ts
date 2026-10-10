import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { VideoAnalysis, VideoRef } from './analysis.schema';
import { GeminiVideoAnalyzer } from './analyzers/gemini-video-analyzer';
import { MockVideoAnalyzer } from './analyzers/mock-video-analyzer';
import type { VideoAnalyzer } from './analyzers/video-analyzer';
import { TranscriptCacheService } from './transcript-cache.service';

export interface AnalysisOutcome {
  analysis: VideoAnalysis;
  fromCache: boolean;
}

/**
 * Cache-first orchestration: lookup (provider+model+schema keyed) -> analyze
 * with the analyzer for the current mode -> persist successful results.
 */
@Injectable()
export class VideoAnalysisService {
  constructor(
    private readonly cache: TranscriptCacheService,
    private readonly config: AppConfig,
    private readonly gemini: GeminiVideoAnalyzer,
    private readonly mock: MockVideoAnalyzer,
  ) {}

  analyzer(): VideoAnalyzer {
    return this.config.llmMode === 'live' ? this.gemini : this.mock;
  }

  provider(): 'gemini' | 'mock' {
    return this.analyzer().provider;
  }

  model(): string {
    return this.analyzer().model();
  }

  cached(videoId: string): VideoAnalysis | null {
    return this.cache.get(videoId, this.provider(), this.model());
  }

  /** Fresh analyses for the current provider/model. */
  known(): VideoAnalysis[] {
    return this.cache.list({ provider: this.provider(), model: this.model() });
  }

  async analyze(ref: VideoRef): Promise<AnalysisOutcome> {
    const hit = this.cached(ref.videoId);
    if (hit) return { analysis: hit, fromCache: true };
    const analysis = await this.analyzer().analyze(ref);
    if (analysis.status === 'ok') this.cache.set(analysis);
    return { analysis, fromCache: false };
  }

  /** Analyze with bounded concurrency, preserving input order. */
  async analyzeMany(refs: VideoRef[], concurrency = this.config.analysisConcurrency): Promise<AnalysisOutcome[]> {
    return mapLimit(refs, concurrency, (r) => this.analyze(r));
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
