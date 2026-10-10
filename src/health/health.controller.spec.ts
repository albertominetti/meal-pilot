import { HealthController } from './health.controller';

describe('HealthController', () => {
  const mockConfig = {
    effectiveLlmMode: 'mock' as const,
    geminiModel: 'gemini-3.8-flash',
  };

  it('returns ok status, mode, model and db state', async () => {
    const ctrl = new HealthController(mockConfig as any, { ping: async () => 'disabled' } as any);
    expect(await ctrl.check()).toEqual({
      status: 'ok',
      service: 'meal-pilot',
      mode: 'mock',
      model: 'gemini-3.8-flash',
      db: 'disabled',
    });
  });

  it('reports degraded, not an error, when the database is down', async () => {
    const ctrl = new HealthController(mockConfig as any, { ping: async () => 'down' } as any);
    expect(await ctrl.check()).toMatchObject({ status: 'degraded', db: 'down' });
  });
});
