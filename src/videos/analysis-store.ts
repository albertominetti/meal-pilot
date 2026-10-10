import { VideoAnalysis } from './analyzers/analysis.schema';

export const ANALYSIS_STORE = Symbol('ANALYSIS_STORE');

export const ANALYSIS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Where video analyses live: Postgres when DATABASE_URL is set, otherwise
 * JSON files (tests, local mock runs). Only current-schema entries count.
 */
export interface AnalysisStore {
  get(videoId: string, provider: 'gemini' | 'mock', model: string): Promise<VideoAnalysis | null>;
  set(entry: VideoAnalysis, currentSystemMode?: 'live' | 'mock'): Promise<VideoAnalysis>;
  list(): Promise<VideoAnalysis[]>;
  clear(videoId?: string): Promise<{ cleared: number }>;
}

/** Unavailable results and mock results in live mode are never stored. */
export function shouldPersist(entry: VideoAnalysis, currentSystemMode?: 'live' | 'mock'): boolean {
  if (entry.status === 'unavailable') return false;
  if (currentSystemMode === 'live' && entry.provider === 'mock') return false;
  return true;
}

export function isExpired(analyzedAt: string | undefined, ttlMs = ANALYSIS_TTL_MS): boolean {
  if (!analyzedAt) return true;
  const time = new Date(analyzedAt).getTime();
  if (isNaN(time)) return true;
  return Date.now() - time > ttlMs;
}
