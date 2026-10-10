import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

interface HttpRequest extends Request {
  id?: string;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap((responseBody) => {
        this.logRequest({
          request,
          response,
          responseBody,
          durationMs: Date.now() - startedAt,
        });
      }),
      catchError((error: unknown) => {
        this.logRequest({
          request,
          response,
          responseBody: this.errorBody(error),
          durationMs: Date.now() - startedAt,
          error: true,
        });
        return throwError(() => error);
      }),
    );
  }

  private logRequest({
    request,
    response,
    responseBody,
    durationMs,
    error = false,
  }: {
    request: HttpRequest;
    response: Response;
    responseBody: unknown;
    durationMs: number;
    error?: boolean;
  }): void {
    const entry = {
      requestId: request.id,
      method: request.method,
      url: request.originalUrl || request.url,
      requestBody: request.body,
      statusCode: response.statusCode,
      responseBody,
      durationMs,
    };

    this.logger[error ? 'error' : 'log'](JSON.stringify(entry));
  }

  private errorBody(error: unknown): { error: string } {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}