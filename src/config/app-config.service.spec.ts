import { AppConfig, validateEnv } from './app-config.service';

describe('AppConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('auto mode resolves to live only when a key is present', () => {
    delete process.env.MEALPILOT_LLM_MODE;
    delete process.env.GEMINI_API_KEY;
    expect(new AppConfig().llmMode).toBe('mock');
    process.env.GEMINI_API_KEY = 'k';
    expect(new AppConfig().llmMode).toBe('live');
  });

  it('explicit mock wins over a key', () => {
    process.env.GEMINI_API_KEY = 'k';
    process.env.MEALPILOT_LLM_MODE = 'mock';
    expect(new AppConfig().llmMode).toBe('mock');
    expect(new AppConfig().describe().model).toBe('mock');
  });

  it('defaults to a current Gemini model and allows override', () => {
    delete process.env.GEMINI_MODEL;
    expect(new AppConfig().geminiModel).toBe('gemini-3.8-flash');
    process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
    expect(new AppConfig().geminiModel).toBe('gemini-3.5-flash-lite');
  });

  it('falls back on invalid integers', () => {
    process.env.AGENT_MAX_STEPS = 'abc';
    expect(new AppConfig().agentMaxSteps).toBe(12);
  });

  it('validateEnv rejects live mode without a key and bad modes', () => {
    expect(() => validateEnv({ MEALPILOT_LLM_MODE: 'live' })).toThrow(/GEMINI_API_KEY/);
    expect(() => validateEnv({ MEALPILOT_LLM_MODE: 'turbo' })).toThrow(/auto\|live\|mock/);
    expect(validateEnv({ MEALPILOT_LLM_MODE: 'live', GEMINI_API_KEY: 'x' })).toBeTruthy();
  });

  it('describe() never exposes keys', () => {
    process.env.GEMINI_API_KEY = 'secret-key';
    process.env.YOUTUBE_API_KEY = 'yt-secret';
    expect(JSON.stringify(new AppConfig().describe())).not.toMatch(/secret/);
  });
});
