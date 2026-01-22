import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Departments } from '../entities/entities/Departments';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { Companies } from '../entities/entities/Companies';
import { Users } from '../entities/entities/Users';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Departments, Companies, Users]),
    NotificationsModule,
  ],
  providers: [DepartmentsService],
  controllers: [DepartmentsController],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
