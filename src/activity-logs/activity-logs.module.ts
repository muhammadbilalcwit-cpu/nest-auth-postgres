import { Global, Module } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { ActivityLogsController } from './activity-logs.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogs } from 'src/entities/entities/ActivityLogs';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityLogs])],
  providers: [ActivityLogsService],
  controllers: [ActivityLogsController],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
