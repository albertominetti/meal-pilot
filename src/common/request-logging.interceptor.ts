import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

interface HttpRequest extends Request {
  id?: string;
}

/**
 * Logs request metadata only. Bodies and query strings are never logged,
 * because they carry the health profile (allergies, blood pressure, goals),
 * which is GDPR Art. 9 special-category data.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<Response>();

    if (this.isHealthCheck(request)) {
      return next.handle();
    }

    const startedAt = Date.now();
    const url = request.originalUrl || request.url;
    if (url === '/api/health' || url.startsWith('/api/health?')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.logRequest({
          request,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        });
      }),
      catchError((error: unknown) => {
        this.logRequest({
          request,
          statusCode: error instanceof HttpException ? error.getStatus() : 500,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
        return throwError(() => error);
      }),
    );
  }

  private logRequest({
    request,
    statusCode,
    durationMs,
    error,
  }: {
    request: HttpRequest;
    statusCode: number;
    durationMs: number;
    error?: string;
  }): void {
    const entry = {
      requestId: request.id,
      method: request.method,
      path: (request.originalUrl || request.url).split('?')[0],
      statusCode,
      durationMs,
      ...(error ? { error } : {}),
    };

    this.logger[error ? 'error' : 'log'](JSON.stringify(entry, null, 2));
  }

  private isHealthCheck(request: HttpRequest): boolean {
    return (request.originalUrl || request.url).split('?')[0] === '/health';
  }
}
