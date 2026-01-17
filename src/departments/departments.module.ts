import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Departments } from '../entities/entities/Departments';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { Companies } from '../entities/entities/Companies';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Departments, Companies]),
    NotificationsModule,
  ],
  providers: [DepartmentsService],
  controllers: [DepartmentsController],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
