import { Module } from '@nestjs/common';
import { join } from 'path';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { UserModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
import { Users } from './entities/entities/Users';
import { Roles } from './entities/entities/Roles';
import { UserRoles } from './entities/entities/UserRoles';
import { Companies } from './entities/entities/Companies';
import { Departments } from './entities/entities/Departments';
import { Sessions } from './entities/entities/Sessions';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SessionsModule } from './sessions/sessions.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [Users, Roles, UserRoles, Companies, Departments, Sessions],
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
    }),
    RedisModule,
    NotificationsModule,
    SessionsModule,
    AuthModule,
    UserModule,
    RolesModule,
    CompaniesModule,
    DepartmentsModule,
    ActivityLogsModule,
    ChatModule,
  ],
  controllers: [],
  providers: [AppService],
})
export class AppModule {}
