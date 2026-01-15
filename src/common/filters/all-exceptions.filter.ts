import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : exception;

    // Normalize message to a string (handle string | object | array)
    let message: string;
    if (typeof raw === 'string') {
      message = raw;
    } else if (Array.isArray((raw as any)?.message)) {
      message = (raw as any).message.join(', ');
    } else if (typeof (raw as any)?.message === 'string') {
      message = (raw as any).message;
    } else {
      try {
        message = JSON.stringify(raw);
        console.log('message:', message);
      } catch (e) {
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
