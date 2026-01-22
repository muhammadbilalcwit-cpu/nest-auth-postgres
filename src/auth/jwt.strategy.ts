import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  StrategyOptionsWithoutRequest,
  ExtractJwt as ExtractJwtOriginal,
} from 'passport-jwt';

type JwtExtractor = (req: Request) => string | null;
const ExtractJwt = ExtractJwtOriginal as {
  fromExtractors: (extractors: JwtExtractor[]) => JwtExtractor;
  fromAuthHeaderAsBearerToken: () => JwtExtractor;
};
import { UserService } from 'src/users/users.service';
import { AuthUser } from 'src/common/interfaces/auth-user.interface';
import type { Request } from 'express';

interface JwtPayload {
  sub: number;
  email: string;
  companyId?: number;
  departmentId?: number;
  roles?: string[];
  iat?: number;
  exp?: number;
}

interface UserRole {
  role: {
    slug: string;
  };
}

const cookieExtractor = (req: Request): string | null => {
  if (!req?.cookies) return null;
  return (req.cookies as Record<string, string>).accessToken || null;
};

const PassportJwtStrategy = PassportStrategy(Strategy) as new (
  options: StrategyOptionsWithoutRequest,
) => InstanceType<ReturnType<typeof PassportStrategy>>;

@Injectable()
export class JwtStrategy extends PassportJwtStrategy {
  constructor(
    private readonly userService: UserService,
    configService: ConfigService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser | null> {
    // ALWAYS fetch fresh roles from DB to handle role updates
    // This ensures users get new permissions immediately after role changes
    const dbUser = await this.userService.findOne(payload.sub);
    if (!dbUser) return null;

    // Reject inactive users - they should not be able to access the system
    if (!dbUser.isActive) {
      console.log('JwtStrategy: rejected inactive user', { sub: payload.sub });
      return null;
    }

    // Get all roles: primary role + additional roles from userRoles
    const userRoles = (dbUser.userRoles || []) as UserRole[];
    const roles = [dbUser.role?.slug, ...userRoles.map((r) => r.role.slug)]
      .filter((r): r is string => Boolean(r))
      .map((r) => r.toLowerCase().trim());

    // Normalize and return a lightweight AuthUser for guards/controllers
    const normalized: AuthUser = {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      companyId: dbUser.company?.id ?? payload.companyId,
      departmentId: dbUser.department?.id ?? payload.departmentId,
      roles,
    };

    console.log('JwtStrategy: validated user', {
      sub: payload.sub,
      roles: normalized.roles,
    });

    return normalized;
  }
}
