import { BadRequestException, CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

const profile = {
  allergies: ['peanuts'],
  bloodPressure: 'high',
  goals: ['lose weight'],
};

function contextFor(url: string, statusCode = 201): ExecutionContext {
  const request = { method: 'POST', originalUrl: url, body: { profile } };
  const response = { statusCode };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RequestLoggingInterceptor', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs metadata only, never bodies or query strings', async () => {
    const next: CallHandler = { handle: () => of({ profile, items: [] }) };

    await lastValueFrom(
      new RequestLoggingInterceptor().intercept(
        contextFor('/api/meal-plan?allergy=peanuts'),
        next,
      ),
    );

    const line = log.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toEqual({
      method: 'POST',
      path: '/api/meal-plan',
      statusCode: 201,
      durationMs: expect.any(Number),
    });
    expect(line).not.toMatch(/peanuts|bloodPressure|allergies|high/);
  });

  it('logs the error status and name without the message', async () => {
    const next: CallHandler = {
      handle: () =>
        throwError(() => new BadRequestException('allergies: peanuts invalid')),
    };

    await expect(
      lastValueFrom(
        new RequestLoggingInterceptor().intercept(contextFor('/api/meal-plan'), next),
      ),
    ).rejects.toThrow(BadRequestException);

    const line = error.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      statusCode: 400,
      error: 'BadRequestException',
    });
    expect(line).not.toMatch(/peanuts/);
  });
});
