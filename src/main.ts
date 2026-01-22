import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const cookieParser: typeof import('cookie-parser') = require('cookie-parser');
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);

  // REQUIRED for req.cookies / res.cookie
  app.use(cookieParser());

  // REQUIRED for browser / swagger cookies
  app.enableCors({
    origin: ['http://localhost:3000'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Register global interceptor and exception filter
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Register simple request/response logging middleware
  app.use((req: Request, res: Response, next: NextFunction) =>
    new LoggingMiddleware().use(req, res, next),
  );

  const logger = new Logger('Bootstrap');
  logger.log('Request/Response logging enabled');

  const config = new DocumentBuilder()
    .setTitle('NestJS Auth')
    .setDescription('CRUD + JWT Authentication')
    .setVersion('1.0')
    // .addBearerAuth(
    //   { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    //   'JWT',
    // )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      withCredentials: true, // REQUIRED
    },
  });

  await app.listen(port);
  console.log(`Server running on port ${port}`);
}
void bootstrap();
