import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok status', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok', service: 'meal-pilot' });
  });
});
