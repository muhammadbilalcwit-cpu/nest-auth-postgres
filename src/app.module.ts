import { Module } from '@nestjs/common';
// import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
// import { PassportModule } from '@nestjs/passport';
import { Users } from './entities/entities/Users';
import { Roles } from './entities/entities/Roles';
import { UserRoles } from './entities/entities/UserRoles';
import { Companies } from './entities/entities/Companies';
import { Departments } from './entities/entities/Departments';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
// import { WalModule } from './wal/wal.module'; // WAL disabled - wal2json not available on Windows

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // <-- makes ConfigModule available everywhere
    }),
    // PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [Users, Roles, UserRoles, Companies, Departments],
        autoLoadEntities: true,
        synchronize: false, // DB first
      }),
    }),
    RedisModule,
    NotificationsModule,
    // WalModule, // WAL disabled - wal2json not available on Windows
    AuthModule,
    UserModule,
    RolesModule,
    CompaniesModule,
    DepartmentsModule,
    ActivityLogsModule,
  ],
  controllers: [],
  providers: [
    AppService,
    // {
    //   provide: APP_INTERCEPTOR,
    //   useClass: CacheInterceptor,
    // },
  ],
})
export class AppModule {}
