import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';

export const APP_KEY_HEADER = 'x-api-key';
const USER_SCOPED_BODY = 'appKey:userScopedBody';

/** Require the key only when the body names a user (it then reads stored health data). */
export const RequireAppKeyForUserBody = () => SetMetadata(USER_SCOPED_BODY, true);

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * The JJFit app owns identity and calls this service with a shared key
 * (MEALPILOT_APP_KEY). Without a configured key the user-data endpoints are
 * open in development and refused in production.
 */
@Injectable()
export class AppKeyGuard implements CanActivate {
  constructor(
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const userScoped = this.reflector.get<boolean>(USER_SCOPED_BODY, context.getHandler());
    if (userScoped && !(request.body as { userId?: unknown } | undefined)?.userId) return true;

    const expected = this.config.appKey;
    if (!expected) {
      if (this.config.nodeEnv === 'production') {
        throw new ServiceUnavailableException('User data endpoints are disabled: MEALPILOT_APP_KEY is not configured');
      }
      return true;
    }

    const sent = request.headers[APP_KEY_HEADER];
    // Compare digests so length differences don't leak through timing.
    if (typeof sent === 'string' && timingSafeEqual(digest(sent), digest(expected))) return true;
    throw new UnauthorizedException('Missing or invalid x-api-key');
  }
}
