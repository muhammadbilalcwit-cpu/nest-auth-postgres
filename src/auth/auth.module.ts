import { forwardRef, Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { RolesModule } from '../roles/roles.module';
import { SessionsModule } from '../sessions/sessions.module';

@Global()
@Module({
  imports: [
    forwardRef(() => UserModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: 'KJdkfjkdfjkj_dsofkdf_@#@!@#@!@#@!@#',
      signOptions: { expiresIn: '1d' },
    }),
    // RolesModule used to lookup default role by slug
    RolesModule,
    // SessionsModule for session tracking
    SessionsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [PassportModule, JwtModule],
})
export class AuthModule {}
