import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok status with LLM config summary', () => {
    const res = new HealthController().check();
    expect(res).toMatchObject({ status: 'ok', service: 'meal-pilot' });
    expect(res.llm.mode).toMatch(/live|mock/);
  });
});
