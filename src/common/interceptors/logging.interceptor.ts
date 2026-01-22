import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Response');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const now = Date.now();

    return next.handle().pipe(
      tap((data: unknown) => {
        const res = context.switchToHttp().getResponse<Response>();
        const status = res.statusCode;
        // Avoid logging full response bodies for large objects; summarize length/type
        let summary = '';
        try {
          if (data === undefined) summary = '[no body]';
          else if (typeof data === 'object' && data !== null)
            summary = `[object with keys=${Object.keys(data).length}]`;
          else summary = JSON.stringify(data).slice(0, 200);
        } catch {
          summary = '[unserializable]';
        }

        this.logger.log(
          `${method} ${url} ${status} - ${Date.now() - now}ms - ${summary}`,
        );
      }),
    );
  }
}
