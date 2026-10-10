import { validateConfig } from './app-config';

describe('validateConfig', () => {
  it('applies defaults correctly', () => {
    const config = validateConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(config.MEALPILOT_LLM_MODE).toBe('auto');
    expect(config.effectiveLlmMode).toBe('mock');
    expect(config.AGENT_MAX_STEPS).toBe(12);
    expect(config.AGENT_MAX_ANALYSES).toBe(8);
    expect(config.AGENT_MAX_SEARCHES).toBe(4);
    expect(config.AGENT_TIMEOUT_MS).toBe(90000);
    expect(config.ANALYSIS_CONCURRENCY).toBe(3);
  });

  it('resolves live mode in auto when GEMINI_API_KEY is present', () => {
    const config = validateConfig({
      GEMINI_API_KEY: 'test-key',
    });
    expect(config.effectiveLlmMode).toBe('live');
  });

  it('forces mock mode when MEALPILOT_LLM_MODE is mock even if key is present', () => {
    const config = validateConfig({
      GEMINI_API_KEY: 'test-key',
      MEALPILOT_LLM_MODE: 'mock',
    });
    expect(config.effectiveLlmMode).toBe('mock');
  });

  it('fails fast when MEALPILOT_LLM_MODE is live but GEMINI_API_KEY is missing', () => {
    expect(() =>
      validateConfig({
        MEALPILOT_LLM_MODE: 'live',
      }),
    ).toThrow(/GEMINI_API_KEY is required/);
  });
});
