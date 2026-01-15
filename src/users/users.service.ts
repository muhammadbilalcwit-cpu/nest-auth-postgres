import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { Repository } from 'typeorm';
import { RolesService } from '../roles/roles.service';
import { CreateUserDto } from './dto/create-user.dto';
import { normalizeRoleSlug } from '../common/utils/roles';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { UserRoles } from 'src/entities/entities/UserRoles';
import { ActivityLogsService } from 'src/activity-logs/activity-logs.service';
import { RequestContext } from 'src/common/interfaces/request-context.interface';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(Users)
    private repo: Repository<Users>,
    @InjectRepository(Departments)
    private departmentRepo: Repository<Departments>,
    private rolesService: RolesService,
    @InjectRepository(UserRoles)
    private userRolesRepo: Repository<UserRoles>,
    private readonly activityLogsService: ActivityLogsService,
  ) {}

  // Normalize requester roles to accept either `roles` array or legacy `role` property
  private _normalizeRequesterRoles(requester: AuthUser | null) {
    console.log('Normalizing roles for requester', requester);
    const rawRoles = requester
      ? (requester as any).roles ||
        ((requester as any).role ? [(requester as any).role] : [])
      : [];
    return (rawRoles || []).map(normalizeRoleSlug).filter(Boolean);
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
      data = maybeData as CreateUserDto;
    }

    const toSave: Partial<Users> = { ...data };

    if (data.roleSlug) {
      const role = await this.rolesService.findBySlug(data.roleSlug);
      if (!role) throw new NotFoundException('Role not found');
      toSave.role = role;
    }

    if (typeof data.departmentId !== 'undefined') {
      const dept = await this.departmentRepo.findOne({
        where: { id: data.departmentId },
        relations: ['company'],
      });
      if (!dept) throw new NotFoundException('Department not found');
      toSave.department = dept;
      // remove raw id so TypeORM update/save doesn't try to set a nonexistent column
      delete (toSave as any).departmentId;
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
          this.activityLogsService.logForbiddenAccess({
            userId: requester?.id,
            username: requester?.email,
            ipAddress: ctx?.ipAddress || '',
            api: ctx?.api || '',
            method: ctx?.method || '',
          });

          throw new ForbiddenException('Not allowed to assign this role');
        }
        // must assign departmentId within same company
        if (typeof data.departmentId !== 'undefined') {
          if (!requester.departmentId) {
            // Log forbidden access attempt
            this.activityLogsService.logForbiddenAccess({
              userId: requester?.id,
              username: requester?.email,
              ipAddress: ctx?.ipAddress || '',
              api: ctx?.api || '',
              method: ctx?.method || '',
            });

            throw new ForbiddenException(
              'Requester department mapping missing',
            );
          }
          const requesterDept = await this.departmentRepo.findOne({
            where: { id: requester.departmentId },
            relations: ['company'],
          });
          const dept = await this.departmentRepo.findOne({
            where: { id: data.departmentId },
            relations: ['company'],
          });
          if (
            !requesterDept ||
            !dept ||
            requesterDept.company?.id !== dept.company?.id
          ) {
            // Log forbidden access attempt
            this.activityLogsService.logForbiddenAccess({
              userId: requester?.id,
              username: requester?.email,
              ipAddress: ctx?.ipAddress || '',
              api: ctx?.api || '',
              method: ctx?.method || '',
            });

            throw new ForbiddenException(
              'Not allowed to create user in this company',
            );
          }
        }
      }
    }

    return this.repo.save(toSave as Users);
  }

  // requester-aware listing
  async findAllWithAccess(requester?: AuthUser | null): Promise<Users[]> {
    if (!requester) return [];

    const requesterRoles = this._normalizeRequesterRoles(requester);

    if (requesterRoles.includes('super_admin')) {
      return this.repo.find({
        relations: ['role', 'userRoles', 'userRoles.role'],
      });
    }

    if (requesterRoles.includes('company_admin')) {
      if (!requester.departmentId) return [];

      const requesterDept = await this.departmentRepo.findOne({
        where: { id: requester.departmentId },
        relations: ['company'],
      });
      if (!requesterDept?.company) return [];

      return this.repo
        .createQueryBuilder('u')
        .leftJoin('departments', 'd', 'd.id = u.department_id')
        .leftJoinAndSelect('u.role', 'primaryRole')
        .leftJoinAndSelect('u.userRoles', 'ur')
        .leftJoinAndSelect('ur.role', 'extraRole')
        .where('d.company_id = :companyId', {
          companyId: requesterDept.company.id,
        })
        .getMany();
    }

    if (requesterRoles.includes('manager')) {
      if (!requester.departmentId) return [];

      return this.repo
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.role', 'primaryRole')
        .leftJoin('u.userRoles', 'ur')
        .leftJoin('ur.role', 'extraRole')
        .where('u.department_id = :deptId', {
          deptId: requester.departmentId,
        })
        .andWhere(
          `
      (
        LOWER(primaryRole.slug) = :userRole
        OR LOWER(extraRole.slug) = :userRole
        OR u.id = :managerId
      )
      `,
          {
            userRole: 'user',
            managerId: requester.id,
          },
        )
        .getMany();
    }

    // plain user: only self
    return this.repo.find({ where: { id: requester.id }, relations: ['role'] });
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
      if (!requester?.departmentId) {
        console.log('ctx: ', ctx);
        // Log forbidden access attempt
        this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException();
      }
      const requesterDept = await this.departmentRepo.findOne({
        where: { id: requester.departmentId },
        relations: ['company'],
      });
      if (!requesterDept || !requesterDept.company) {
        // Log forbidden access attempt
        this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException();
      }
      const companyId = requesterDept.company.id;
      if (!target.department?.id) {
        // Log forbidden access attempt
        this.activityLogsService.logForbiddenAccess({
          userId: requester?.id,
          username: requester?.email,
          ipAddress: ctx?.ipAddress || '',
          api: ctx?.api || '',
          method: ctx?.method || '',
        });
        throw new ForbiddenException();
      }
      const targetDept = await this.departmentRepo.findOne({
        where: { id: target.department.id },
        relations: ['company'],
      });
      if (targetDept?.company?.id === companyId) return target;

      // Log forbidden access attempt
      this.activityLogsService.logForbiddenAccess({
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
        this.activityLogsService.logForbiddenAccess({
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
        this.activityLogsService.logForbiddenAccess({
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
      this.activityLogsService.logForbiddenAccess({
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
    this.activityLogsService.logForbiddenAccess({
      userId: requester?.id,
      username: requester?.email,
      ipAddress: ctx?.ipAddress || '',
      api: ctx?.api || '',
      method: ctx?.method || '',
    });

    throw new ForbiddenException();
  }

  findOne(id: number) {
    return this.repo.findOne({
      where: { id },
      relations: ['role', 'userRoles', 'userRoles.role', 'department'],
    });
  }

  findByEmail(email: string) {
    return this.repo.findOne({
      where: { email },
      relations: ['role', 'userRoles', 'userRoles.role', 'department'],
    });
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
        delete (toUpdate as any).roleSlug;
      }

      if (typeof data.departmentId !== 'undefined') {
        const dept = await this.departmentRepo.findOne({
          where: { id: data.departmentId },
        });
        if (!dept) throw new NotFoundException('Department not found');
        toUpdate.department = dept;
        // remove raw id to avoid TypeORM error updating a non-column property
        delete (toUpdate as any).departmentId;
      }

      // If password is being updated, hash it before saving
      if (data.password) {
        const bcrypt = await import('bcrypt');
        toUpdate.password = await bcrypt.hash(data.password, 10);
      }

      await this.repo.update(id, toUpdate);
      return this.findOne(id);
    }

    // Log forbidden access attempt
    this.activityLogsService.logForbiddenAccess({
      userId: requester?.id,
      username: requester?.email,
      ipAddress: ctx?.ipAddress || '',
      api: ctx?.api || '',
      method: ctx?.method || '',
    });

    throw new ForbiddenException();
  }

  delete(id: number) {
    return this.repo.delete(id);
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
      this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException('Not allowed to assign roles');
    }

    // company_admin cannot assign super_admin
    if (
      requesterRoles.includes('company_admin') &&
      roleSlugs.some((r) => normalizeRoleSlug(r) === 'super_admin')
    ) {
      // Log forbidden access attempt
      this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException('Cannot assign super_admin role');
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

    return this.findOne(userId);
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
      this.activityLogsService.logForbiddenAccess({
        userId: requester?.id,
        username: requester?.email,
        ipAddress: ctx?.ipAddress || '',
        api: ctx?.api || '',
        method: ctx?.method || '',
      });

      throw new ForbiddenException();
    }

    const role = await this.rolesService.findBySlug(roleSlug);
    if (!role) throw new NotFoundException('Role not found');

    await this.userRolesRepo.delete({
      user: { id: userId },
      role: { id: role.id },
    });

    return this.findOne(userId);
  }
}
