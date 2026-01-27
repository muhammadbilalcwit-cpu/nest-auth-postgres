import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Companies } from '../entities/entities/Companies';
import { Departments } from '../entities/entities/Departments';
import { Notifications } from '../entities/entities/Notifications';
import { UserNotifications } from '../entities/entities/UserNotifications';
import { Users } from '../entities/entities/Users';
import { Sessions } from '../entities/entities/Sessions';
import { RedisModule } from '../redis/redis.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([
      Companies,
      Departments,
      Notifications,
      UserNotifications,
      Users,
      Sessions,
    ]),
    RedisModule,
    forwardRef(() => SessionsModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, NotificationsService],
  exports: [NotificationsGateway, NotificationsService],
})
export class NotificationsModule {}
