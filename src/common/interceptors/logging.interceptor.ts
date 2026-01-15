import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Response');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const now = Date.now();

    return next.handle().pipe(
      tap((data) => {
        const res = context.switchToHttp().getResponse();
        const status = (res as any).statusCode;
        // Avoid logging full response bodies for large objects; summarize length/type
        let summary = '';
        try {
          if (data === undefined) summary = '[no body]';
          else if (typeof data === 'object')
            summary = `[object with keys=${Object.keys(data).length}]`;
          else summary = String(data).slice(0, 200);
        } catch (e) {
          summary = '[unserializable]';
        }

        this.logger.log(
          `${method} ${url} ${status} - ${Date.now() - now}ms - ${summary}`,
        );
      }),
    );
  }
}
