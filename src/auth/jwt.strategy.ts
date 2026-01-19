import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from 'src/users/users.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';

const cookieExtractor = (req: any): string | null => {
  if (!req?.cookies) return null;
  return req.cookies.accessToken || null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor, // Browser (cookies)
        ExtractJwt.fromAuthHeaderAsBearerToken(), // Swagger/Postman
      ]),
      secretOrKey: 'KJdkfjkdfjkj_dsofkdf_@#@!@#@!@#@!@#',
    });
  }

  async validate(payload: any): Promise<AuthUser | null> {
    // ALWAYS fetch fresh roles from DB to handle role updates
    // This ensures users get new permissions immediately after role changes
    const dbUser = await this.userService.findOne(payload.sub);
    if (!dbUser) return null;

    // Get all roles: primary role + additional roles from userRoles
    const roles = [
      dbUser.role?.slug,
      ...(dbUser.userRoles || []).map((r) => r.role.slug),
    ].filter(Boolean) as string[];

    // Normalize and return a lightweight AuthUser for guards/controllers
    const normalized = {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      companyId: dbUser.company?.id ?? payload.companyId,
      departmentId: dbUser.department?.id ?? payload.departmentId,
      roles: roles.map((r) => String(r).toLowerCase().trim()),
    } as AuthUser;

    console.log('JwtStrategy: validated user', {
      sub: payload.sub,
      roles: normalized.roles,
    });

    return normalized;
  }
}
