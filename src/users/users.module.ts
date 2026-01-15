import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { RolesModule } from '../roles/roles.module';
import { UserRoles } from 'src/entities/entities/UserRoles';

@Module({
  imports: [
    TypeOrmModule.forFeature([Users, Departments, UserRoles]),
    RolesModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
