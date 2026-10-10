import { LandingController } from './landing.controller';

describe('LandingController', () => {
  it('exposes a root redirect handler (target enforced by @Redirect)', () => {
    expect(new LandingController().redirectToDocs()).toBeUndefined();
  });
});
