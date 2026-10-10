import { z } from 'zod';

export const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  MEALPILOT_LLM_MODE: z.enum(['auto', 'live', 'mock']).default('auto'),
  YOUTUBE_API_KEY: z.string().default(''),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(12),
  AGENT_MAX_ANALYSES: z.coerce.number().int().positive().default(8),
  AGENT_MAX_SEARCHES: z.coerce.number().int().positive().default(4),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(3),
  MEALPILOT_CACHE_DIR: z.string().default(''),
});

export type RawAppConfig = z.infer<typeof configSchema>;

export interface AppConfig extends RawAppConfig {
  effectiveLlmMode: 'live' | 'mock';
}

export function validateConfig(config: Record<string, unknown>): AppConfig {
  const merged = { ...config, ...process.env };
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Configuration validation error: ${parsed.error.message}`);
  }

  const values = parsed.data;

  if (values.MEALPILOT_LLM_MODE === 'live' && !values.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is required when MEALPILOT_LLM_MODE is set to "live"',
    );
  }

  let effectiveLlmMode: 'live' | 'mock';
  if (values.MEALPILOT_LLM_MODE === 'live') {
    effectiveLlmMode = 'live';
  } else if (values.MEALPILOT_LLM_MODE === 'mock') {
    effectiveLlmMode = 'mock';
  } else {
    effectiveLlmMode = values.GEMINI_API_KEY ? 'live' : 'mock';
  }

  return {
    ...values,
    effectiveLlmMode,
  };
}
