import { VideoAnalysis } from './analysis.schema';

export interface VideoTarget {
  videoId: string;
  title: string;
  channel: string;
  channelId?: string;
  /** Untrusted uploader text; the analyzer treats it as data, never instructions. */
  description?: string;
}

export interface VideoAnalyzer {
  provider(): 'gemini' | 'mock';
  model(): string;
  analyze(target: VideoTarget): Promise<VideoAnalysis>;
}

export const VIDEO_ANALYZER = Symbol('VIDEO_ANALYZER');
