import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sessions } from '../entities/entities/Sessions';
import { SessionsService } from './sessions.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sessions]),
    forwardRef(() => NotificationsModule),
  ],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
