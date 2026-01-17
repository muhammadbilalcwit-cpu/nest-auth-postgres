import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsGateway } from './notifications.gateway';
import { Departments } from '../entities/entities/Departments';

@Module({
  imports: [
    JwtModule.register({
      secret: 'KJdkfjkdfjkj_dsofkdf_@#@!@#@!@#@!@#',
    }),
    TypeOrmModule.forFeature([Departments]),
  ],
  providers: [NotificationsGateway],
  exports: [NotificationsGateway],
})
export class NotificationsModule {}
