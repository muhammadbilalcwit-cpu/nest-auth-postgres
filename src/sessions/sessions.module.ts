import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sessions } from '../entities/entities/Sessions';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Sessions])],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}