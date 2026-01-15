import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const res = context.switchToHttp().getResponse();

    return next.handle().pipe(
      map((data) => {
        // If controller already returned formatted response → leave it
        if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          'status_code' in data &&
          'data' in data
        ) {
          return data;
        }

        return {
          message: 'Request successful',
          status_code: res.statusCode ?? 200,
          data: data ?? null,
        };
      }),
    );
  }
}
