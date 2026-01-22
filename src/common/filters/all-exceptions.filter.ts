import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ExceptionResponseObject {
  message?: string | string[];
  [key: string]: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : exception;

    // Normalize message to a string (handle string | object | array)
    let message: string;
    if (typeof raw === 'string') {
      message = raw;
    } else if (
      typeof raw === 'object' &&
      raw !== null &&
      'message' in raw &&
      Array.isArray((raw as ExceptionResponseObject).message)
    ) {
      message = ((raw as ExceptionResponseObject).message as string[]).join(
        ', ',
      );
    } else if (
      typeof raw === 'object' &&
      raw !== null &&
      'message' in raw &&
      typeof (raw as ExceptionResponseObject).message === 'string'
    ) {
      message = (raw as ExceptionResponseObject).message as string;
    } else {
      try {
        message = JSON.stringify(raw);
        console.log('message:', message);
      } catch {
        message = 'Unexpected error';
      }
    }

    // Log full details to terminal (keep details out of the API response)
    this.logger.error(
      `${request.method} ${request.url} ${status} - ${message} - raw: ${JSON.stringify(raw)}`,
    );

    // Send minimal error response (only what should be exposed to clients)
    response.status(status).json({
      message,
      statusCode: status,
      data: null,
    });
  }
}
