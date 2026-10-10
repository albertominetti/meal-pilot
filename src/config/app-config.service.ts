import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './app-config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get geminiApiKey(): string {
    return this.config.get('GEMINI_API_KEY', { infer: true });
  }

  get geminiModel(): string {
    return this.config.get('GEMINI_MODEL', { infer: true });
  }

  get mealpilotLlmMode(): 'auto' | 'live' | 'mock' {
    return this.config.get('MEALPILOT_LLM_MODE', { infer: true });
  }

  get youtubeApiKey(): string {
    return this.config.get('YOUTUBE_API_KEY', { infer: true });
  }

  get agentMaxSteps(): number {
    return this.config.get('AGENT_MAX_STEPS', { infer: true });
  }

  get agentMaxAnalyses(): number {
    return this.config.get('AGENT_MAX_ANALYSES', { infer: true });
  }

  get agentMaxSearches(): number {
    return this.config.get('AGENT_MAX_SEARCHES', { infer: true });
  }

  get agentTimeoutMs(): number {
    return this.config.get('AGENT_TIMEOUT_MS', { infer: true });
  }

  get analysisConcurrency(): number {
    return this.config.get('ANALYSIS_CONCURRENCY', { infer: true });
  }

  get cacheDir(): string {
    return this.config.get('MEALPILOT_CACHE_DIR', { infer: true });
  }

  get effectiveLlmMode(): 'live' | 'mock' {
    return this.config.get('effectiveLlmMode', { infer: true });
  }
}
