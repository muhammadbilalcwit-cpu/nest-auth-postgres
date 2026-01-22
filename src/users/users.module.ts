import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { Companies } from '../entities/entities/Companies';
import { RolesModule } from '../roles/roles.module';
import { UserRoles } from 'src/entities/entities/UserRoles';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Users, Departments, Companies, UserRoles]),
    RolesModule,
    NotificationsModule,
    SessionsModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
