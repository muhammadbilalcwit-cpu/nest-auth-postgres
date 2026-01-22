import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';

interface FormattedResponse {
  message: string;
  status_code: number;
  data: unknown;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<FormattedResponse> {
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown): FormattedResponse => {
        // If controller already returned formatted response → leave it
        if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          'status_code' in data &&
          'data' in data
        ) {
          return data as FormattedResponse;
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
