import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Companies } from '../entities/entities/Companies';
import { Departments } from '../entities/entities/Departments';
import { Users } from '../entities/entities/Users';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Companies, Departments, Users]),
    NotificationsModule,
  ],
  providers: [CompaniesService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}
