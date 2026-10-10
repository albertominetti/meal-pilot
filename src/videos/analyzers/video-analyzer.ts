import type { VideoAnalysis, VideoRef } from '../analysis.schema';

export interface VideoAnalyzer {
  readonly provider: 'gemini' | 'mock';
  model(): string;
  /** Never throws: failures come back as `status: "unavailable"`. */
  analyze(ref: VideoRef): Promise<VideoAnalysis>;
}
