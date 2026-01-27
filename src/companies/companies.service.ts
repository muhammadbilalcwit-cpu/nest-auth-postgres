import {
  Inject,
  Injectable,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Companies } from '../entities/entities/Companies';
import { Departments } from '../entities/entities/Departments';
import { Users } from '../entities/entities/Users';
import type Redis from 'ioredis';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AuthUser } from '../common/interfaces/auth-user.interface';

@Injectable()
export class CompaniesService implements OnModuleInit {
  private readonly CACHE_PREFIX = 'company';
  private readonly MAX_ID_KEY = 'company:max_id';

  constructor(
    @InjectRepository(Companies)
    private repo: Repository<Companies>,
    @InjectRepository(Departments)
    private departmentsRepo: Repository<Departments>,
    @InjectRepository(Users)
    private usersRepo: Repository<Users>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  // ---------------- ON MODULE INIT ----------------
  // Smart sync: Only fetch new records from DB on server start
  async onModuleInit() {
    console.log('CompaniesService: Starting smart cache sync...');
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
      .createQueryBuilder('c')
      .select('MAX(c.id)', 'maxId')
      .getRawOne();
    const dbMaxId: number = result?.maxId || 0;

    console.log(
      `CompaniesService: Redis data keys: ${dataKeys.length}, Redis max ID: ${lastSyncedId}, DB max ID: ${dbMaxId}`,
    );

    // Step 4: Full sync if Redis is empty, otherwise incremental sync
    if (redisIsEmpty && dbMaxId > 0) {
      // Redis is empty - do full sync from DB
      console.log('CompaniesService: Redis is empty, doing full sync from DB');
      const allRecords = await this.repo.find();

      if (allRecords.length > 0) {
        await Promise.all(
          allRecords.map((company) =>
            this.redis.set(
              `${this.CACHE_PREFIX}:${company.id}`,
              JSON.stringify(company),
            ),
          ),
        );
        await this.redis.set(this.MAX_ID_KEY, dbMaxId.toString());
        console.log(
          `CompaniesService: Full sync - cached ${allRecords.length} companies in Redis`,
        );
      }
    } else if (dbMaxId > lastSyncedId) {
      // Incremental sync - only fetch new records
      const newRecords = await this.repo
        .createQueryBuilder('c')
        .where('c.id > :lastId', { lastId: lastSyncedId })
        .getMany();

      if (newRecords.length > 0) {
        await Promise.all(
          newRecords.map((company) =>
            this.redis.set(
              `${this.CACHE_PREFIX}:${company.id}`,
              JSON.stringify(company),
            ),
          ),
        );
        await this.redis.set(this.MAX_ID_KEY, dbMaxId.toString());
        console.log(
          `CompaniesService: Incremental sync - cached ${newRecords.length} new companies`,
        );
      }
    } else {
      console.log('CompaniesService: Redis is up to date, no sync needed');
    }
  }

  // ---------------- CREATE ----------------
  async create(data: Partial<Companies>, performer?: AuthUser) {
    const company = await this.repo.save(data);

    // Cache in Redis (permanent - no TTL)
    await this.redis.set(
      `${this.CACHE_PREFIX}:${company.id}`,
      JSON.stringify(company),
    );

    // Update max ID if this is a new highest
    const currentMaxId = await this.redis.get(this.MAX_ID_KEY);
    if (!currentMaxId || company.id > parseInt(currentMaxId, 10)) {
      await this.redis.set(this.MAX_ID_KEY, company.id.toString());
    }

    console.log(`create: Cached company:${company.id} in Redis`);

    // Emit notification to company users (for new company, notify that company)
    if (performer) {
      void this.notificationsGateway.emitNotification({
        companyId: company.id,
        type: 'company:created',
        title: 'Company Created',
        message: `New company "${company.name}" has been created`,
        data: company as object,
        actorId: performer.id,
        actorEmail: performer.email,
      });
    }

    return company;
  }

  // ---------------- FIND ALL ----------------
  // Returns data ONLY from Redis - no DB fallback
  async findAll() {
    // Get all company keys from Redis
    const redisKeys = await this.redis.keys(`${this.CACHE_PREFIX}:*`);
    // Filter out the max_id key
    const companyKeys = redisKeys.filter((key) => key !== this.MAX_ID_KEY);

    if (companyKeys.length === 0) {
      console.log('findAll: No companies in Redis');
      return [];
    }

    // Use MGET for better performance (single Redis call)
    const cachedData = await this.redis.mget(companyKeys);
    const results = cachedData
      .filter((data): data is string => data !== null)
      .map((data) => JSON.parse(data) as Companies)
      .sort((a, b) => a.id - b.id); // Sort by ID ascending

    console.log(`findAll: Returned ${results.length} companies from Redis`);
    return results;
  }

  // ---------------- FIND ALL WITH ACCESS ----------------
  // Returns companies based on user role
  async findAllWithAccess(requester: AuthUser) {
    const allCompanies = await this.findAll();

    // Normalize roles
    const roles = (requester.roles || []).map((r) =>
      String(r).toLowerCase().trim(),
    );

    // super_admin sees all companies
    if (roles.includes('super_admin')) {
      return allCompanies;
    }

    // company_admin sees only their company
    if (roles.includes('company_admin')) {
      if (!requester.companyId) {
        console.log('findAllWithAccess: company_admin has no companyId');
        return [];
      }
      const filtered = allCompanies.filter(
        (company) => company.id === requester.companyId,
      );
      console.log(
        `findAllWithAccess: company_admin sees ${filtered.length} companies`,
      );
      return filtered;
    }

    // Other roles see no companies
    return [];
  }

  // ---------------- FIND ONE ----------------
  // Returns data ONLY from Redis - no DB fallback
  async findOne(id: number) {
    const key = `${this.CACHE_PREFIX}:${id}`;

    const cached = await this.redis.get(key);
    if (cached) {
      console.log(`findOne: Returned company ${id} from Redis`);
      return JSON.parse(cached) as Companies;
    }

    console.log(`findOne: Company ${id} not found in Redis`);
    return null;
  }

  // ---------------- UPDATE ----------------
  async update(id: number, data: Partial<Companies>, performer?: AuthUser) {
    await this.repo.update(id, data);
    const company = await this.repo.findOne({ where: { id } });

    if (company) {
      // Update Redis cache (permanent - no TTL)
      await this.redis.set(
        `${this.CACHE_PREFIX}:${id}`,
        JSON.stringify(company),
      );
      console.log(`update: Updated company:${id} in Redis`);

      // Emit notification to company users
      if (performer) {
        void this.notificationsGateway.emitNotification({
          companyId: id,
          type: 'company:updated',
          title: 'Company Updated',
          message: `Company "${company.name}" has been updated`,
          data: company as object,
          actorId: performer.id,
          actorEmail: performer.email,
        });
      }
    }

    return company;
  }

  // ---------------- DELETE ----------------
  async delete(id: number, performer?: AuthUser) {
    // Get company before deleting
    const company = await this.repo.findOne({ where: { id } });
    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Check for related departments
    const departmentCount = await this.departmentsRepo.count({
      where: { company: { id } },
    });
    if (departmentCount > 0) {
      throw new BadRequestException(
        `Cannot delete company "${company.name}". It has ${departmentCount} department${departmentCount > 1 ? 's' : ''} attached. Please delete the departments first.`,
      );
    }

    // Check for related users
    const userCount = await this.usersRepo.count({
      where: { company: { id } },
    });
    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete company "${company.name}". It has ${userCount} user${userCount > 1 ? 's' : ''} attached. Please delete or reassign the users first.`,
      );
    }

    const companyName = company.name;

    await this.repo.delete(id);

    // Remove from Redis
    await this.redis.del(`${this.CACHE_PREFIX}:${id}`);
    console.log(`delete: Removed company:${id} from Redis`);

    // Emit notification to company users before they disconnect
    if (performer) {
      void this.notificationsGateway.emitNotification({
        companyId: id,
        type: 'company:deleted',
        title: 'Company Deleted',
        message: `Company "${companyName}" has been deleted`,
        data: { id, name: companyName },
        actorId: performer.id,
        actorEmail: performer.email,
      });
    }

    return { deleted: true };
  }
}
