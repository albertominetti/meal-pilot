import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppKeyGuard } from './app-key.guard';

function context(headers: Record<string, string>, body: unknown = {}, userScoped = false) {
  const reflector = { get: () => userScoped } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ headers, body }) }),
    getHandler: () => undefined,
  } as any;
  return { reflector, ctx };
}

describe('AppKeyGuard', () => {
  const guard = (appKey: string, nodeEnv = 'production', userScoped = false, headers = {}, body = {}) => {
    const { reflector, ctx } = context(headers, body, userScoped);
    return () => new AppKeyGuard({ appKey, nodeEnv } as any, reflector).canActivate(ctx);
  };

  it('accepts the right key and rejects a wrong or missing one', () => {
    expect(guard('secret', 'production', false, { 'x-api-key': 'secret' })()).toBe(true);
    expect(guard('secret', 'production', false, { 'x-api-key': 'nope' })).toThrow(UnauthorizedException);
    expect(guard('secret')).toThrow(UnauthorizedException);
  });

  it('is open in development without a key and closed in production', () => {
    expect(guard('', 'development')()).toBe(true);
    expect(guard('', 'production')).toThrow(ServiceUnavailableException);
  });

  it('on meal-plan routes, asks for the key only when the body names a user', () => {
    expect(guard('secret', 'production', true, {}, { restrictions: ['vegan'] })()).toBe(true);
    expect(guard('secret', 'production', true, {}, { userId: 'u1' })).toThrow(UnauthorizedException);
  });
});
