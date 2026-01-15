import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { normalizeRoleSlug } from '../utils/roles';
import { ActivityLogsService } from 'src/activity-logs/activity-logs.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private activityLogService: ActivityLogsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !Array.isArray(user.roles)) {
      console.log('RolesGuard: missing roles on request.user', { user });
      return false;
    }

    // roles from JWT
    const normalizedUserRoles = user.roles
      .map(normalizeRoleSlug)
      .filter(Boolean);

    // super_admin shortcut
    if (normalizedUserRoles.includes('super_admin')) {
      return true;
    }

    const normalizedRequired = requiredRoles
      .map(normalizeRoleSlug)
      .filter(Boolean);

    const allowed = normalizedRequired.some((role) =>
      normalizedUserRoles.includes(role),
    );

    if (!allowed) {
      console.log('yes came here');
      console.log('RolesGuard DENY:', {
        requiredRoles,
        normalizedRequired,
        normalizedUserRoles,
      });

      // Log forbidden access attempt
      this.activityLogService.logForbiddenAccess({
        userId: user?.id,
        username: user?.email,
        ipAddress: request.ip,
        api: request.originalUrl,
        method: request.method,
      });
    }
    console.log('allowed:', allowed);
    return allowed;
  }
}
