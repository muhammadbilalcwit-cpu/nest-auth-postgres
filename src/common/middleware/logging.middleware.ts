import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const start = Date.now();

    // clone body and redact passwords
    let body: Record<string, unknown> | undefined = undefined;
    try {
      body = { ...(req.body as Record<string, unknown>) };
      if (body && typeof body === 'object' && 'password' in body) {
        body.password = '[REDACTED]';
      }
    } catch {
      // ignore
    }

    this.logger.log(
      `--> ${method} ${originalUrl} ${body ? JSON.stringify(body) : ''}`,
    );

    res.on('finish', () => {
      const elapsed = Date.now() - start;
      this.logger.log(
        `<-- ${method} ${originalUrl} ${res.statusCode} ${elapsed}ms`,
      );
    });

    next();
  }
}
