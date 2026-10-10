import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok status, mode, and model', () => {
    const mockConfig = {
      effectiveLlmMode: 'mock' as const,
      geminiModel: 'gemini-3.8-flash',
    };
    const ctrl = new HealthController(mockConfig as any);
    expect(ctrl.check()).toEqual({
      status: 'ok',
      service: 'meal-pilot',
      mode: 'mock',
      model: 'gemini-3.8-flash',
    });
  });
});
