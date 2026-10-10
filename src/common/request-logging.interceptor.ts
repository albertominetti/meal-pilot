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
 * Logs request metadata for all routes. For POST /api/meal-plan the full
 * request and response bodies are also logged.
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
      tap((responseBody) => {
        this.logRequest({
          request,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
          responseBody,
        });
      }),
      catchError((error: unknown) => {
        this.logRequest({
          request,
          statusCode: error instanceof HttpException ? error.getStatus() : 500,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.name : 'UnknownError',
          responseBody: error instanceof HttpException ? error.getResponse() : undefined,
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
    responseBody,
  }: {
    request: HttpRequest;
    statusCode: number;
    durationMs: number;
    error?: string;
    responseBody?: unknown;
  }): void {
    const path = (request.originalUrl || request.url).split('?')[0];
    const includeBodies = path === '/api/meal-plan';
    const entry = {
      requestId: request.id,
      method: request.method,
      path,
      statusCode,
      durationMs,
      ...(error ? { error } : {}),
      ...(includeBodies ? { requestBody: request.body, responseBody } : {}),
    };

    this.logger[error ? 'error' : 'log'](JSON.stringify(entry, null, 2));
  }

  private isHealthCheck(request: HttpRequest): boolean {
    return (request.originalUrl || request.url).split('?')[0] === '/health';
  }
}
