import { Injectable, Logger } from '@nestjs/common';

export type LlmMode = 'live' | 'mock';
export type LlmModeSetting = 'auto' | LlmMode;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/**
 * Typed, single place to read runtime configuration.
 *
 * Values are read from process.env on every call (not snapshotted at boot) so
 * tests can tweak process.env between cases. ConfigModule loads `.env` into
 * process.env at startup (existing env vars win).
 */
@Injectable()
export class AppConfig {
  private readonly logger = new Logger(AppConfig.name);

  private raw(key: string): string | undefined {
    const v = process.env[key];
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  }

  private int(key: string, fallback: number, min = 0): number {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < min) {
      this.logger.warn(`Invalid ${key}=${v}; using ${fallback}`);
      return fallback;
    }
    return n;
  }

  get geminiApiKey(): string | undefined {
    return this.raw('GEMINI_API_KEY');
  }

  get youtubeApiKey(): string | undefined {
    return this.raw('YOUTUBE_API_KEY');
  }

  get llmModeSetting(): LlmModeSetting {
    const v = (this.raw('MEALPILOT_LLM_MODE') ?? 'auto').toLowerCase();
    return v === 'live' || v === 'mock' ? v : 'auto';
  }

  /** Effective mode: `auto` resolves to live iff a key is present. */
  get llmMode(): LlmMode {
    const setting = this.llmModeSetting;
    if (setting === 'auto') return this.geminiApiKey ? 'live' : 'mock';
    return setting;
  }

  get geminiModel(): string {
    return this.raw('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
  }

  /** Model used for per-video analysis (defaults to GEMINI_MODEL). */
  get analysisModel(): string {
    return this.raw('GEMINI_ANALYSIS_MODEL') ?? this.geminiModel;
  }

  /** Media resolution for video input: low|medium|high (low = cheapest). */
  get videoResolution(): string {
    return this.raw('GEMINI_VIDEO_RESOLUTION') ?? 'low';
  }

  get llmTimeoutMs(): number {
    return this.int('GEMINI_TIMEOUT_MS', 120_000, 1000);
  }

  get analysisConcurrency(): number {
    return this.int('ANALYSIS_CONCURRENCY', 3, 1);
  }

  get maxVideoMinutes(): number {
    return this.int('MAX_VIDEO_MINUTES', 25, 1);
  }

  get cacheTtlDays(): number {
    return this.int('CACHE_TTL_DAYS', 30, 0);
  }

  get agentMaxSteps(): number {
    return this.int('AGENT_MAX_STEPS', 12, 1);
  }

  get agentMaxSearches(): number {
    return this.int('AGENT_MAX_SEARCHES', 4, 0);
  }

  get agentMaxAnalyses(): number {
    return this.int('AGENT_MAX_ANALYSES', 8, 1);
  }

  get agentTimeoutMs(): number {
    return this.int('AGENT_TIMEOUT_MS', 150_000, 1000);
  }

  get youtubeDailyQuota(): number {
    return this.int('YOUTUBE_DAILY_QUOTA', 9000, 0);
  }

  get youtubeRegion(): string | undefined {
    return this.raw('YOUTUBE_REGION');
  }

  /** Non-secret summary for /api/health and response meta. */
  describe() {
    return {
      mode: this.llmMode,
      modeSetting: this.llmModeSetting,
      model: this.llmMode === 'live' ? this.geminiModel : 'mock',
      analysisModel: this.llmMode === 'live' ? this.analysisModel : 'mock',
      youtubeSearch: Boolean(this.youtubeApiKey),
    };
  }
}

/** Boot-time validation used by ConfigModule.forRoot({ validate }). */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const mode = String(env.MEALPILOT_LLM_MODE ?? 'auto').trim().toLowerCase();
  if (mode && !['auto', 'live', 'mock'].includes(mode)) {
    throw new Error(`MEALPILOT_LLM_MODE must be auto|live|mock (got "${mode}")`);
  }
  if (mode === 'live' && !String(env.GEMINI_API_KEY ?? '').trim()) {
    throw new Error('MEALPILOT_LLM_MODE=live requires GEMINI_API_KEY');
  }
  return env;
}
