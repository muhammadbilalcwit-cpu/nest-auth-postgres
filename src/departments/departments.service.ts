import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departments } from '../entities/entities/Departments';
import { Companies } from '../entities/entities/Companies';
import type Redis from 'ioredis';
import {
  NotificationsGateway,
  NotificationPayload,
} from '../notifications/notifications.gateway';
import { AuthUser } from '../common/interfaces/auth-user.interface';

@Injectable()
export class DepartmentsService implements OnModuleInit {
  private readonly CACHE_PREFIX = 'department';
  private readonly MAX_ID_KEY = 'department:max_id';

  constructor(
    @InjectRepository(Departments)
    private repo: Repository<Departments>,
    @InjectRepository(Companies)
    private companiesRepo: Repository<Companies>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  // ---------------- ON MODULE INIT ----------------
  // Smart sync: Only fetch new records from DB on server start
  async onModuleInit() {
    console.log('DepartmentsService: Starting smart cache sync...');
    await this.smartCacheSync();
  }

  private async smartCacheSync() {
    // Step 1: Check if Redis has any data keys (not just max_id)
    const existingKeys = await this.redis.keys(`${this.CACHE_PREFIX}:*`);
    const dataKeys = existingKeys.filter((key) => key !== this.MAX_ID_KEY);
    const redisIsEmpty = dataKeys.length === 0;

    // Step 2: Get max ID from Redis (last synced ID)
    const cachedMaxId = await this.redis.get(this.MAX_ID_KEY);
    const lastSyncedId = cachedMaxId ? parseInt(cachedMaxId, 10) : 0;

    // Step 3: Get current max ID from DB (single query)
    const result: { maxId: number | null } | undefined = await this.repo
      .createQueryBuilder('d')
      .select('MAX(d.id)', 'maxId')
      .getRawOne();
    const dbMaxId: number = result?.maxId || 0;

    console.log(
      `DepartmentsService: Redis data keys: ${dataKeys.length}, Redis max ID: ${lastSyncedId}, DB max ID: ${dbMaxId}`,
    );

    // Step 4: Full sync if Redis is empty, otherwise incremental sync
    if (redisIsEmpty && dbMaxId > 0) {
      // Redis is empty - do full sync from DB
      console.log('DepartmentsService: Redis is empty, doing full sync from DB');
      const allRecords = await this.repo.find({ relations: ['company'] });

      if (allRecords.length > 0) {
        await Promise.all(
          allRecords.map((dept) =>
            this.redis.set(
              `${this.CACHE_PREFIX}:${dept.id}`,
              JSON.stringify(dept),
            ),
          ),
        );
        await this.redis.set(this.MAX_ID_KEY, dbMaxId.toString());
        console.log(
          `DepartmentsService: Full sync - cached ${allRecords.length} departments in Redis`,
        );
      }
    } else if (dbMaxId > lastSyncedId) {
      // Incremental sync - only fetch new records
      const newRecords = await this.repo
        .createQueryBuilder('d')
        .leftJoinAndSelect('d.company', 'company')
        .where('d.id > :lastId', { lastId: lastSyncedId })
        .getMany();

      if (newRecords.length > 0) {
        await Promise.all(
          newRecords.map((dept) =>
            this.redis.set(
              `${this.CACHE_PREFIX}:${dept.id}`,
              JSON.stringify(dept),
            ),
          ),
        );
        await this.redis.set(this.MAX_ID_KEY, dbMaxId.toString());
        console.log(
          `DepartmentsService: Incremental sync - cached ${newRecords.length} new departments`,
        );
      }
    } else {
      console.log('DepartmentsService: Redis is up to date, no sync needed');
    }
  }

  // ---------------- CREATE ----------------
  async create(
    data: Partial<Departments> & { companyId?: number },
    performer?: AuthUser,
  ) {
    const dept = this.repo.create();
    Object.assign(dept, data as Partial<Departments>);

    let companyId: number | null = null;

    if (data.companyId) {
      const comp = await this.companiesRepo.findOne({
        where: { id: data.companyId },
      });
      if (!comp) throw new NotFoundException('Company not found');
      dept.company = comp;
      companyId = comp.id;
    }

    const saved = await this.repo.save(dept);

    // Fetch with relations for caching
    const deptWithRelations = await this.repo.findOne({
      where: { id: saved.id },
      relations: ['company'],
    });

    if (deptWithRelations) {
      // Cache in Redis (permanent - no TTL)
      await this.redis.set(
        `${this.CACHE_PREFIX}:${deptWithRelations.id}`,
        JSON.stringify(deptWithRelations),
      );

      // Update max ID if this is a new highest
      const currentMaxId = await this.redis.get(this.MAX_ID_KEY);
      if (!currentMaxId || deptWithRelations.id > parseInt(currentMaxId, 10)) {
        await this.redis.set(this.MAX_ID_KEY, deptWithRelations.id.toString());
      }

      console.log(`create: Cached department:${deptWithRelations.id} in Redis`);

      // Emit notification to company users
      if (companyId && performer) {
        const notification: NotificationPayload = {
          type: 'department:created',
          message: `New department "${deptWithRelations.name}" has been created`,
          data: deptWithRelations,
          performedBy: { id: performer.id, email: performer.email },
          timestamp: new Date().toISOString(),
        };
        this.notificationsGateway.emitToCompany(companyId, notification);
      }
    }

    return deptWithRelations || saved;
  }

  // ---------------- FIND ALL ----------------
  // Returns data ONLY from Redis - no DB fallback
  async findAll() {
    // Get all department keys from Redis
    const redisKeys = await this.redis.keys(`${this.CACHE_PREFIX}:*`);
    // Filter out the max_id key
    const deptKeys = redisKeys.filter((key) => key !== this.MAX_ID_KEY);

    if (deptKeys.length === 0) {
      console.log('findAll: No departments in Redis');
      return [];
    }

    // Use MGET for better performance (single Redis call)
    const cachedData = await this.redis.mget(deptKeys);
    const results = cachedData
      .filter((data): data is string => data !== null)
      .map((data) => JSON.parse(data) as Departments)
      .sort((a, b) => a.id - b.id); // Sort by ID ascending

    console.log(`findAll: Returned ${results.length} departments from Redis`);
    return results;
  }

  // ---------------- FIND ALL WITH ACCESS ----------------
  // Returns departments based on user role
  async findAllWithAccess(requester: AuthUser) {
    const allDepartments = await this.findAll();

    // Normalize roles
    const roles = (requester.roles || []).map((r) =>
      String(r).toLowerCase().trim(),
    );

    // super_admin sees all departments
    if (roles.includes('super_admin')) {
      return allDepartments;
    }

    // company_admin sees only their company's departments
    if (roles.includes('company_admin')) {
      if (!requester.companyId) {
        console.log('findAllWithAccess: company_admin has no companyId');
        return [];
      }
      const filtered = allDepartments.filter(
        (dept) => dept.company?.id === requester.companyId,
      );
      console.log(
        `findAllWithAccess: company_admin sees ${filtered.length} departments`,
      );
      return filtered;
    }

    // manager sees only their department
    if (roles.includes('manager')) {
      if (!requester.departmentId) {
        console.log('findAllWithAccess: manager has no departmentId');
        return [];
      }
      const filtered = allDepartments.filter(
        (dept) => dept.id === requester.departmentId,
      );
      console.log(
        `findAllWithAccess: manager sees ${filtered.length} departments`,
      );
      return filtered;
    }

    // Regular users see no departments
    return [];
  }

  // ---------------- FIND ONE ----------------
  // Returns data ONLY from Redis - no DB fallback
  async findOne(id: number) {
    const key = `${this.CACHE_PREFIX}:${id}`;

    const cached = await this.redis.get(key);
    if (cached) {
      console.log(`findOne: Returned department ${id} from Redis`);
      return JSON.parse(cached) as Departments;
    }

    console.log(`findOne: Department ${id} not found in Redis`);
    return null;
  }

  // ---------------- FIND BY COMPANY ----------------
  // Returns departments for a specific company from Redis
  async findByCompany(companyId: number) {
    // Get all department keys from Redis
    const redisKeys = await this.redis.keys(`${this.CACHE_PREFIX}:*`);
    // Filter out the max_id key
    const deptKeys = redisKeys.filter((key) => key !== this.MAX_ID_KEY);

    if (deptKeys.length === 0) {
      console.log('findByCompany: No departments in Redis');
      return [];
    }

    // Use MGET for better performance (single Redis call)
    const cachedData = await this.redis.mget(deptKeys);
    const allDepartments = cachedData
      .filter((data): data is string => data !== null)
      .map((data) => JSON.parse(data) as Departments);

    // Filter by company ID and sort by ID ascending
    const results = allDepartments
      .filter((dept) => dept.company?.id === companyId)
      .sort((a, b) => a.id - b.id);

    console.log(
      `findByCompany: Returned ${results.length} departments for company ${companyId} from Redis`,
    );
    return results;
  }

  // ---------------- UPDATE ----------------
  async update(id: number, data: Partial<Departments>, performer?: AuthUser) {
    // Get existing department to know the company
    const existingDept = await this.repo.findOne({
      where: { id },
      relations: ['company'],
    });

    await this.repo.update(id, data);
    const dept = await this.repo.findOne({
      where: { id },
      relations: ['company'],
    });

    if (dept) {
      // Update Redis cache (permanent - no TTL)
      await this.redis.set(`${this.CACHE_PREFIX}:${id}`, JSON.stringify(dept));
      console.log(`update: Updated department:${id} in Redis`);

      // Emit notification to company users
      const companyId = dept.company?.id || existingDept?.company?.id;
      if (companyId && performer) {
        const notification: NotificationPayload = {
          type: 'department:updated',
          message: `Department "${dept.name}" has been updated`,
          data: dept,
          performedBy: { id: performer.id, email: performer.email },
          timestamp: new Date().toISOString(),
        };
        this.notificationsGateway.emitToCompany(companyId, notification);
      }
    }

    return dept;
  }

  // ---------------- DELETE ----------------
  async delete(id: number, performer?: AuthUser) {
    // Get department before deleting to know company
    const dept = await this.repo.findOne({
      where: { id },
      relations: ['company'],
    });

    const companyId = dept?.company?.id;
    const deptName = dept?.name;

    await this.repo.delete(id);

    // Remove from Redis
    await this.redis.del(`${this.CACHE_PREFIX}:${id}`);
    console.log(`delete: Removed department:${id} from Redis`);

    // Emit notification to company users
    if (companyId && performer) {
      const notification: NotificationPayload = {
        type: 'department:deleted',
        message: `Department "${deptName}" has been deleted`,
        data: { id, name: deptName },
        performedBy: { id: performer.id, email: performer.email },
        timestamp: new Date().toISOString(),
      };
      this.notificationsGateway.emitToCompany(companyId, notification);
    }

    return { deleted: true };
  }
}
