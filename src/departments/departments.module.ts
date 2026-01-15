import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Departments } from '../entities/entities/Departments';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { Companies } from '../entities/entities/Companies';

@Module({
  imports: [TypeOrmModule.forFeature([Departments, Companies])],
  providers: [DepartmentsService],
  controllers: [DepartmentsController],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
