import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { Companies } from '../entities/entities/Companies';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { RolesService } from '../roles/roles.service';
import { CreateUserDto } from './dto/create-user.dto';
import { normalizeRoleSlug } from '../common/utils/roles';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { UserRoles } from 'src/entities/entities/UserRoles';
import { ActivityLogsService } from 'src/activity-logs/activity-logs.service';
import { RequestContext } from 'src/common/interfaces/request-context.interface';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SessionsService } from '../sessions/sessions.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(Users)
    private repo: Repository<Users>,
    @InjectRepository(Departments)
    private departmentRepo: Repository<Departments>,
    @InjectRepository(Companies)
    private companyRepo: Repository<Companies>,
    private rolesService: RolesService,
    @InjectRepository(UserRoles)
    private userRolesRepo: Repository<UserRoles>,
    private readonly activityLogsService: ActivityLogsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly sessionsService: SessionsService,
  ) {}

  // Normalize requester roles to accept either `roles` array or legacy `role` property
  private _normalizeRequesterRoles(requester: AuthUser | null): string[] {
    console.log('Normalizing roles for requester', requester);
    const rawRoles: string[] = requester
      ? (requester as { roles?: string[]; role?: string }).roles ||
        ((requester as { role?: string }).role
          ? [(requester as { role?: string }).role]
          : [])
      : [];
    return (rawRoles || [])
      .map((r) => normalizeRoleSlug(r))
      .filter((r): r is string => Boolean(r));
  }

  // Transform user to add computed 'roles' array from userRoles relation
  private _transformUser(
    user: Users,
  ): Users & { roles: { id: number; name: string; slug: string }[] } {
    const roles: { id: number; name: string; slug: string }[] = (
      user.userRoles || []
    )
      .map((ur) => ({
        id: ur.role?.id,
        name: ur.role?.name || '',
        slug: ur.role?.slug,
      }))
      .filter((r): r is { id: number; name: string; slug: string } => !!r.id);

    // Include primary role in roles array if exists
    if (user.role && !roles.some((r) => r.id === user.role.id)) {
      roles.unshift({
        id: user.role.id,
        name: user.role.name || '',
        slug: user.role.slug,
      });
    }

    return {
      ...user,
      roles,
    };
  }

  // Transform array of users
  private _transformUsers(
    users: Users[],
  ): (Users & { roles: { id: number; name: string; slug: string }[] })[] {
    return users.map((u) => this._transformUser(u));
  }

  // Create with optional requester to enforce company_admin restrictions
  async create(
    requesterOrData: AuthUser | CreateUserDto,
    maybeData?: CreateUserDto,
    ctx?: RequestContext,
  ): Promise<Users> {
    let requester: AuthUser | null = null;
    let data: CreateUserDto;

    // allow calling either create(data) or create(requester, data)
    if (maybeData === undefined) {
      data = requesterOrData as CreateUserDto;
    } else {
      requester = requesterOrData as AuthUser;
      data = maybeData;
    }

    const toSave: Partial<Users> = { ...data };

    if (data.roleSlug) {
      const role = await this.rolesService.findBySlug(data.roleSlug);
      if (!role) throw new NotFoundException('Role not found');
      toSave.role = role;
      // remove non-column property to avoid TypeORM error
      delete (toSave as Partial<Users> & { roleSlug?: string }).roleSlug;
    }

    // Handle departmentId - for manager/user roles
    if (typeof data.departmentId !== 'undefined' && data.departmentId) {
      const dept = await this.departmentRepo.findOne({
        where: { id: data.departmentId },
        relations: ['company'],
      });
      if (!dept) throw new NotFoundException('Department not found');
      toSave.department = dept;
      // Option C: Auto-set company from department (single source of truth)
      if (dept.company) {
        toSave.company = dept.company;
      }
      // remove raw id so TypeORM update/save doesn't try to set a nonexistent column
      delete (toSave as Partial<Users> & { departmentId?: number })
        .departmentId;
    }

    // Handle companyId directly - for company_admin users (no department)
    // This also allows explicit companyId for any role if needed
    if (typeof data.companyId !== 'undefined' && data.companyId) {
      const company = await this.companyRepo.findOne({
        where: { id: data.companyId },
      });
      if (!company) throw new NotFoundException('Company not found');
      toSave.company = company;
      // remove raw id so TypeORM update/save doesn't try to set a nonexistent column
      delete (toSave as Partial<Users> & { companyId?: number }).companyId;
    }

    // If requester is company_admin, enforce they cannot assign higher roles and ensure department belongs to their company
    if (requester) {
      const requesterRoles = this._normalizeRequesterRoles(requester);
      if (requesterRoles.includes('company_admin')) {
        // cannot assign super_admin or company_admin
        const incomingRole = data.roleSlug?.toString().toLowerCase().trim();
        if (
          incomingRole &&
          ['super_admin', 'company_admin'].includes(incomingRole)
        ) {
          // Log forbidden access attempt
          void this.activityLogsService.logForbiddenAccess({
            userId: requester?.id,
            username: requester?.email,
            companyId: requester?.companyId,
            ipAddress: ctx?.ipAddress || '',
            api: ctx?.api || '',
            method: ctx?.method || '',
          });

          throw new ForbiddenException('Not allowed to assign this role');
        }
        // Option C: Validate department belongs to company_admin's company
        if (typeof data.departmentId !== 'undefined' && data.departmentId) {
          if (!requester.companyId) {
            void this.activityLogsService.logForbiddenAccess({
              userId: requester?.id,
              username: requester?.email,
              ipAddress: ctx?.ipAddress || '',
              api: ctx?.api || '',
              method: ctx?.method || '',
            });
            throw new ForbiddenException('Requester company mapping missing');
          }

          const dept = await this.departmentRepo.findOne({
            where: { id: data.departmentId },
            relations: ['company'],
          });

          if (!dept || dept.company?.id !== requester.companyId) {
            void this.activityLogsService.logForbiddenAccess({
              userId: requester?.id,
              username: requester?.email,
              ipAddress: ctx?.ipAddress || '',
              api: ctx?.api || '',
              method: ctx?.method || '',
            });
            throw new ForbiddenException(
              'Not allowed to create user in this department',
            );
          }
        }
      }
    }

    const savedUser = await this.repo.save(toSave as Users);

    // Emit notification to company users
    // Option C: Use company from saved user directly (single source of truth)
    if (requester && toSave.company?.id) {
      void this.notificationsGateway.emitNotification({
        companyId: toSave.company.id,
        type: 'user:created',
        title: 'User Created',
        message: `New user "${savedUser.email}" has been created`,
        data: { id: savedUser.id, email: savedUser.email },
        actorId: requester.id,
        actorEmail: requester.email,
      });
    }

    return savedUser;
  }

  // requester-aware listing
  // includeInactive: super_admin sees all, others see only active by default
  async findAllWithAccess(
    requester?: AuthUser | null,
    includeInactive = false,
  ) {
    if (!requester) return [];

    const requesterRoles = this._normalizeRequesterRoles(requester);

    let users: Users[] = [];

    if (requesterRoles.includes('super_admin')) {
      // super_admin can see all users EXCEPT themselves (manage self via Settings)
      const qb = this.repo
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.role', 'primaryRole')
        .leftJoinAndSelect('u.userRoles', 'ur')
        .leftJoinAndSelect('ur.role', 'extraRole')
        .leftJoinAndSelect('u.department', 'dept')
        .leftJoinAndSelect('dept.company', 'deptCompany')
        .leftJoinAndSelect('u.company', 'company')
        .where('u.id != :requesterId', { requesterId: requester.id });

      if (!includeInactive) {
        qb.andWhere('u.is_active = :isActive', { isActive: true });
      }

      users = await qb.orderBy('u.id', 'ASC').getMany();
    } else if (requesterRoles.includes('company_admin')) {
      // Option C: Use companyId directly from requester (single source of truth)
      if (!requester.companyId) return [];

      const qb = this.repo
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.role', 'primaryRole')
        .leftJoinAndSelect('u.userRoles', 'ur')
        .leftJoinAndSelect('ur.role', 'extraRole')
        .leftJoinAndSelect('u.department', 'dept')
        .leftJoinAndSelect('u.company', 'company')
        .where('u.company_id = :companyId', {
          companyId: requester.companyId,
        });

      // company_admin can see inactive users in their company (for reactivation)
      if (!includeInactive) {
        qb.andWhere('u.is_active = :isActive', { isActive: true });
      }

      const allCompanyUsers = await qb.getMany();

      // Enterprise pattern: Filter out company_admins and sort by role hierarchy
      const roleOrder: Record<string, number> = {
        manager: 1,
        user: 2,
      };

      users = allCompanyUsers
        // Filter out company_admin users - they should not see other company_admins
        .filter((u) => u.role?.slug?.toLowerCase() !== 'company_admin')
        // Sort by role hierarchy (manager first, then user), then alphabetically by name
        .sort((a, b) => {
          const aRole = a.role?.slug?.toLowerCase() || '';
          const bRole = b.role?.slug?.toLowerCase() || '';
          const aOrder = roleOrder[aRole] ?? 99;
          const bOrder = roleOrder[bRole] ?? 99;

          if (aOrder !== bOrder) return aOrder - bOrder;

          // Secondary sort by firstname, then lastname
          const aName =
            `${a.firstname || ''} ${a.lastname || ''}`.toLowerCase();
          const bName =
            `${b.firstname || ''} ${b.lastname || ''}`.toLowerCase();
          return aName.localeCompare(bName);
        });
    } else if (requesterRoles.includes('manager')) {
      if (!requester.departmentId) {
        console.log(
          'findAllWithAccess: manager has no departmentId, returning empty',
        );
        return [];
      }

      // Manager sees all users in their department EXCEPT themselves
      // Enterprise pattern: Manager manages their team, not themselves
      const qb = this.repo
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.role', 'primaryRole')
        .leftJoinAndSelect('u.userRoles', 'ur')
        .leftJoinAndSelect('ur.role', 'extraRole')
        .leftJoinAndSelect('u.department', 'dept')
        .leftJoinAndSelect('u.company', 'company')
        .where('u.department_id = :deptId', {
          deptId: requester.departmentId,
        })
        .andWhere('u.id != :requesterId', {
          requesterId: requester.id,
        });

      // Manager sees only active users by default
      if (!includeInactive) {
        qb.andWhere('u.is_active = :isActive', { isActive: true });
      }

      users = await qb.orderBy('u.id', 'ASC').getMany();
    } else {
      // plain user: only self
      users = await this.repo.find({
        where: { id: requester.id },
        relations: [
          'role',
          'userRoles',
          'userRoles.role',
          'department',
          'department.company',
          'company',
        ],
        order: { id: 'ASC' },
      });
    }

    // Transform users to add computed 'roles' array
    return this._transformUsers(users);
  }

  async findOneWithAccess(
    id: number,
    requester: AuthUser | null,
    ctx?: RequestContext,
  ) {
    const target = await this.findOne(id);
    if (!target) throw new NotFoundException('User not found');

    const requesterRoles = this._normalizeRequesterRoles(requester);
    if (requesterRoles.includes('super_admin')) return target;
    if (requesterRoles.includes('company_admin')) {
      // Option C: Use companyId directly (single source of truth)
      if (!requester?.companyId) {
        void this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException();
      }

      // Check if target user belongs to the same company
      if (target.company?.id === requester.companyId) return target;

      // Log forbidden access attempt
      await this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });
      throw new ForbiddenException();
    }
    if (requesterRoles.includes('manager')) {
      if (!requester?.departmentId) {
        // Log forbidden access attempt
        await this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException();
      }

      const targetRoles = [
        target.role?.slug,
        ...(target.userRoles || []).map((ur) => ur.role?.slug),
      ]
        .filter(Boolean)
        .map((r) => r.toLowerCase());

      // managers can NEVER access company_admin
      if (targetRoles.includes('company_admin')) {
        // Log forbidden access attempt
        await this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });

        throw new ForbiddenException();
      }

      // same department rule
      if (target.department?.id === requester.departmentId) {
        return target;
      }
      // Log forbidden access attempt
      await this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException();
    }

    // user
    if (requester?.id === target.id) return target;

    // Log forbidden access attempt
    await this.activityLogsService.logForbiddenAccess({
      userId: requester?.id,
      username: requester?.email,
      ipAddress: ctx?.ipAddress || '',
      api: ctx?.api || '',
      method: ctx?.method || '',
    });

    throw new ForbiddenException();
  }

  async findOne(id: number) {
    const user = await this.repo.findOne({
      where: { id },
      relations: [
        'role',
        'userRoles',
        'userRoles.role',
        'department',
        'department.company',
        'company',
      ],
    });
    return user ? this._transformUser(user) : null;
  }

  async findByEmail(email: string) {
    const user = await this.repo.findOne({
      where: { email },
      relations: [
        'role',
        'userRoles',
        'userRoles.role',
        'department',
        'department.company',
        'company',
      ],
    });
    return user ? this._transformUser(user) : null;
  }

  // Find user with password for authentication purposes
  findByIdWithPassword(id: number) {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id })
      .getOne();
  }

  // Verify user's current password
  async verifyPassword(userId: number, password: string): Promise<boolean> {
    const user = await this.findByIdWithPassword(userId);
    if (!user || !user.password) return false;

    const bcrypt = await import('bcrypt');
    return bcrypt.compare(password, user.password);
  }

  async update(
    requester: AuthUser,
    id: number,
    data: UpdateUserDto,
    ctx?: RequestContext,
  ) {
    const existing = await this.findOne(id);
    if (!existing) throw new NotFoundException('User not found');

    const requesterRoles = this._normalizeRequesterRoles(requester);
    // super_admin and company_admin can update anyone; users can update self
    if (
      requesterRoles.includes('super_admin') ||
      requesterRoles.includes('company_admin') ||
      requester.id === id
    ) {
      console.log('Updating user', id, 'with data', data);
      const toUpdate: Partial<Users> = { ...data };
      // If a roleSlug was provided, resolve it to the relation and remove the raw roleSlug
      if (data.roleSlug) {
        const r = await this.rolesService.findBySlug(data.roleSlug);
        if (!r) throw new NotFoundException('Role not found');
        toUpdate.role = r;
        // remove non-column property to avoid TypeORM error
        delete (toUpdate as Partial<Users> & { roleSlug?: string }).roleSlug;
      }

      if (typeof data.departmentId !== 'undefined') {
        const dept = await this.departmentRepo.findOne({
          where: { id: data.departmentId },
          relations: ['company'],
        });
        if (!dept) throw new NotFoundException('Department not found');
        toUpdate.department = dept;
        // Option C: Auto-set company from department when updating
        if (dept.company) {
          toUpdate.company = dept.company;
        }
        // remove raw id to avoid TypeORM error updating a non-column property
        delete (toUpdate as Partial<Users> & { departmentId?: number })
          .departmentId;
      }

      // If password is being updated, hash it before saving
      if (data.password) {
        const bcrypt = await import('bcrypt');
        toUpdate.password = await bcrypt.hash(data.password, 10);
      }

      await this.repo.update(id, toUpdate);
      const updatedUser = await this.findOne(id);

      // Option C: Emit notification using user.company directly (single source of truth)
      // Skip notification if user is updating their own profile (self-update)
      const isSelfUpdate = requester.id === id;
      const companyId = updatedUser?.company?.id || existing.company?.id;
      if (companyId && !isSelfUpdate) {
        void this.notificationsGateway.emitNotification({
          companyId,
          type: 'user:updated',
          title: 'User Updated',
          message: `User "${updatedUser?.email}" has been updated`,
          data: { id: updatedUser?.id, email: updatedUser?.email },
          actorId: requester.id,
          actorEmail: requester.email,
        });
      }

      return updatedUser;
    }

    // Log forbidden access attempt
    await this.activityLogsService.logForbiddenAccess({
      userId: requester?.id,
      username: requester?.email,
      ipAddress: ctx?.ipAddress || '',
      api: ctx?.api || '',
      method: ctx?.method || '',
    });

    throw new ForbiddenException();
  }

  async delete(id: number, performer?: AuthUser) {
    // Prevent self-deletion
    if (performer && performer.id === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    // Get user before deleting to know their company
    const user = await this.findOne(id);
    // Option C: Use user.company directly (single source of truth)
    const companyId = user?.company?.id;
    const userEmail = user?.email;

    const result = await this.repo.delete(id);

    // Emit notification to company users
    if (companyId && performer) {
      void this.notificationsGateway.emitNotification({
        companyId,
        type: 'user:deleted',
        title: 'User Deleted',
        message: `User "${userEmail}" has been deleted`,
        data: { id, email: userEmail },
        actorId: performer.id,
        actorEmail: performer.email,
      });
    }

    return result;
  }

  async assignSecondaryRoles(
    requester: AuthUser,
    userId: number,
    roleSlugs: string[],
    ctx?: RequestContext,
  ) {
    const target = await this.findOne(userId);
    if (!target) throw new NotFoundException('User not found');

    const requesterRoles = this._normalizeRequesterRoles(requester);

    // authorization
    if (
      !requesterRoles.includes('super_admin') &&
      !requesterRoles.includes('company_admin')
    ) {
      // Log forbidden access attempt
      await this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException('Not allowed to assign roles');
    }

    // super_admin cannot be assigned as secondary role by anyone
    if (roleSlugs.some((r: string) => normalizeRoleSlug(r) === 'super_admin')) {
      await this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        companyId: requester?.companyId,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException('Cannot assign super_admin role');
    }

    // company_admin cannot assign company_admin as secondary role
    if (requesterRoles.includes('company_admin')) {
      if (
        roleSlugs.some((r: string) => normalizeRoleSlug(r) === 'company_admin')
      ) {
        await this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          companyId: requester?.companyId,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });

        throw new ForbiddenException('Cannot assign company_admin role');
      }
    }

    // Resolve roles
    const roles = await Promise.all(
      roleSlugs.map(async (slug) => {
        const role = await this.rolesService.findBySlug(slug);
        if (!role) throw new NotFoundException(`Role ${slug} not found`);
        return role;
      }),
    );

    // Avoid duplicates
    const existingRoleIds = new Set(
      (target.userRoles || []).map((ur) => ur.role.id),
    );

    const newUserRoles = roles
      .filter((r) => !existingRoleIds.has(r.id))
      .map((role) => {
        const ur = new UserRoles();
        ur.user = target;
        ur.role = role;
        return ur;
      });

    if (!newUserRoles.length) return target;

    await this.repo.manager.save(newUserRoles);

    const updatedUser = await this.findOne(userId);

    // Option C: Emit notification using user.company directly (single source of truth)
    const companyId = target.company?.id;
    if (companyId) {
      void this.notificationsGateway.emitNotification({
        companyId,
        type: 'user:roles_assigned',
        title: 'Roles Assigned',
        message: `Roles "${roleSlugs.join(', ')}" assigned to user "${target.email}"`,
        data: { userId, email: target.email, roles: roleSlugs },
        actorId: requester.id,
        actorEmail: requester.email,
      });
    }

    return updatedUser;
  }

  async removeSecondaryRole(
    requester: AuthUser,
    userId: number,
    roleSlug: string,
    ctx?: RequestContext,
  ) {
    const requesterRoles = this._normalizeRequesterRoles(requester);

    if (
      !requesterRoles.includes('super_admin') &&
      !requesterRoles.includes('company_admin')
    ) {
      // Log forbidden access attempt
      await this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        companyId: requester?.companyId,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException();
    }

    // company_admin cannot remove super_admin or company_admin roles
    if (requesterRoles.includes('company_admin')) {
      const restrictedRoles: string[] = ['super_admin', 'company_admin'];
      if (restrictedRoles.includes(normalizeRoleSlug(roleSlug))) {
        await this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          companyId: requester?.companyId,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });

        throw new ForbiddenException(
          'Cannot remove super_admin or company_admin roles',
        );
      }
    }

    const target = await this.findOne(userId);
    if (!target) throw new NotFoundException('User not found');

    const role = await this.rolesService.findBySlug(roleSlug);
    if (!role) throw new NotFoundException('Role not found');

    await this.userRolesRepo.delete({
      user: { id: userId },
      role: { id: role.id },
    });

    const updatedUser = await this.findOne(userId);

    // Option C: Emit notification using user.company directly (single source of truth)
    const companyId = target.company?.id;
    if (companyId) {
      void this.notificationsGateway.emitNotification({
        companyId,
        type: 'user:role_removed',
        title: 'Role Removed',
        message: `Role "${roleSlug}" removed from user "${target.email}"`,
        data: { userId, email: target.email, role: roleSlug },
        actorId: requester.id,
        actorEmail: requester.email,
      });
    }

    return updatedUser;
  }

  /**
   * Set user active/inactive status with role-based authorization
   * - super_admin: can change status of company_admin, manager, user (not other super_admin)
   * - company_admin: can change status of manager, user in their company (not super_admin or company_admin)
   */
  async setUserActiveStatus(
    requester: AuthUser,
    userId: number,
    isActive: boolean,
    ctx?: RequestContext,
  ): Promise<Users | null> {
    // Prevent self-deactivation
    if (requester.id === userId && !isActive) {
      throw new ForbiddenException('Cannot deactivate your own account');
    }

    const target = await this.findOne(userId);
    if (!target) throw new NotFoundException('User not found');

    const requesterRoles = this._normalizeRequesterRoles(requester);
    const targetRoles = [
      target.role?.slug,
      ...(target.userRoles || []).map((ur) => ur.role?.slug),
    ]
      .filter(Boolean)
      .map((r) => r.toLowerCase().trim());

    // super_admin authorization
    if (requesterRoles.includes('super_admin')) {
      // super_admin cannot deactivate other super_admins
      if (targetRoles.includes('super_admin')) {
        await this.activityLogsService.logForbiddenAccess({
          userId: requester.id,
          username: requester.email,
          companyId: requester.companyId,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException('Cannot change status of super_admin');
      }
      // super_admin can change status of company_admin, manager, user
    }
    // company_admin authorization
    else if (requesterRoles.includes('company_admin')) {
      // company_admin cannot change status of super_admin or company_admin
      if (
        targetRoles.includes('super_admin') ||
        targetRoles.includes('company_admin')
      ) {
        await this.activityLogsService.logForbiddenAccess({
          userId: requester.id,
          username: requester.email,
          companyId: requester.companyId,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException(
          'Cannot change status of super_admin or company_admin',
        );
      }

      // company_admin can only change users in their own company
      if (!requester.companyId || target.company?.id !== requester.companyId) {
        await this.activityLogsService.logForbiddenAccess({
          userId: requester.id,
          username: requester.email,
          companyId: requester.companyId,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException(
          'Cannot change status of users outside your company',
        );
      }
    }
    // Only super_admin and company_admin can change user status
    else {
      await this.activityLogsService.logForbiddenAccess({
        userId: requester.id,
        username: requester.email,
        companyId: requester.companyId,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });
      throw new ForbiddenException('Not authorized to change user status');
    }

    // Perform the status update
    await this.repo.update(userId, {
      isActive,
      deactivatedAt: isActive ? null : new Date(),
    });

    // If deactivating, invalidate all user sessions to force immediate logout
    if (!isActive) {
      await this.sessionsService.invalidateAllUserSessions(userId);
      console.log(`Invalidated all sessions for deactivated user ${userId}`);
    }

    const updatedUser = await this.findOne(userId);

    // Emit notification
    const companyId = target.company?.id;
    if (companyId) {
      const statusText = isActive ? 'activated' : 'deactivated';
      void this.notificationsGateway.emitNotification({
        companyId,
        type: isActive ? 'user:activated' : 'user:deactivated',
        title: isActive ? 'User Activated' : 'User Deactivated',
        message: `User "${target.email}" has been ${statusText}`,
        data: { userId, email: target.email, isActive },
        actorId: requester.id,
        actorEmail: requester.email,
      });
    }

    return updatedUser;
  }

  /**
   * Update user's profile picture
   * @param userId - User ID
   * @param filename - New profile picture filename (relative path)
   * @returns Updated user
   */
  async updateProfilePicture(
    userId: number,
    filename: string,
  ): Promise<Users | null> {
    // Get raw user to access profilePicture field
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Delete old profile picture if exists
    const oldPicture = user.profilePicture as string | null;
    if (oldPicture) {
      const relativePath = oldPicture.replace('/uploads/', '');
      const oldFilePath = path.join(
        __dirname,
        '..',
        '..',
        'uploads',
        relativePath,
      );
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Update database with new profile picture path
    const profilePicturePath = `/uploads/avatars/${filename}`;
    await this.repo.update(userId, { profilePicture: profilePicturePath });

    return this.findOne(userId);
  }

  /**
   * Remove user's profile picture
   * @param userId - User ID
   * @returns Updated user
   */
  async removeProfilePicture(userId: number): Promise<Users | null> {
    // Get raw user to access profilePicture field
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Delete file if exists
    const currentPicture = user.profilePicture as string | null;
    if (currentPicture) {
      const relativePath = currentPicture.replace('/uploads/', '');
      const filePath = path.join(
        __dirname,
        '..',
        '..',
        'uploads',
        relativePath,
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Clear profile picture in database
    await this.repo.update(userId, { profilePicture: null });

    return this.findOne(userId);
  }
}
