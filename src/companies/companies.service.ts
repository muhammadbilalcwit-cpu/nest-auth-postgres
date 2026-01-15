import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Companies } from '../entities/entities/Companies';
import type Redis from 'ioredis';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Companies)
    private repo: Repository<Companies>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // async onModuleInit() {
  //   try {
  //     console.log('🔧 Testing Redis connection with ioredis directly...');

  //     // Test write
  //     await this.redis.setex('redis:test', 300, 'working');
  //     console.log('✅ Redis write successful');

  //     // Test read
  //     const value = await this.redis.get('redis:test');
  //     console.log('✅ Redis read:', value);

  //     // Test object storage
  //     await this.redis.setex(
  //       'test:company:1',
  //       300,
  //       JSON.stringify({ id: 1, name: 'Test Co' }),
  //     );
  //     console.log('✅ Test company cached in Redis');
  //   } catch (error) {
  //     console.error('❌ Redis error:', error);
  //   }
  // }

  // ---------------- CREATE ----------------
  async create(data: Partial<Companies>) {
    // Step 1: Save to DB
    const company = await this.repo.save(data);

    // Step 2: Cache in Redis
    const key = `company:${company.id}`;
    await this.redis.setex(key, 3600, JSON.stringify(company));

    // Step 3: Fetch from Redis to ensure consistency
    const cached = await this.redis.get(key);
    return JSON.parse(cached!) as Companies;
  }

  // ---------------- FIND ALL ----------------
  async findAll() {
    // Step 1: Get all company keys from Redis
    const redisKeys = await this.redis.keys('company:*');

    // Step 2: Check if Redis has any company data
    if (redisKeys.length === 0) {
      // Redis is empty, fetch from DB
      const allCompanies = await this.repo.find();

      // Cache all companies in Redis
      await Promise.all(
        allCompanies.map((company) =>
          this.redis.setex(
            `company:${company.id}`,
            3600,
            JSON.stringify(company),
          ),
        ),
      );

      // Fetch from Redis to ensure consistency
      const results = await Promise.all(
        allCompanies.map(async (company) => {
          const cached = await this.redis.get(`company:${company.id}`);
          return JSON.parse(cached!) as Companies;
        }),
      );

      return results;
    }

    // Step 3: Redis has some data, extract IDs from keys
    const cachedCompanyIds = redisKeys.map((key) =>
      parseInt(key.replace('company:', '')),
    );

    // Step 4: Get all company IDs from DB
    const allCompaniesFromDb = await this.repo.find();
    const allDbIds = allCompaniesFromDb.map((c) => c.id);

    // Step 5: Find missing companies (in DB but not in Redis)
    const missingIds = allDbIds.filter((id) => !cachedCompanyIds.includes(id));

    // Step 6: Cache missing companies in Redis
    if (missingIds.length > 0) {
      const missingCompanies = allCompaniesFromDb.filter((c) =>
        missingIds.includes(c.id),
      );

      await Promise.all(
        missingCompanies.map((company) =>
          this.redis.setex(
            `company:${company.id}`,
            3600,
            JSON.stringify(company),
          ),
        ),
      );
    }

    // Step 7: Fetch ALL companies from Redis (now all are cached)
    const finalResults = await Promise.all(
      allDbIds.map(async (id) => {
        const cached = await this.redis.get(`company:${id}`);
        return JSON.parse(cached!) as Companies;
      }),
    );

    return finalResults;
  }

  // ---------------- FIND ONE ----------------
  async findOne(id: number) {
    const key = `company:${id}`;

    // Step 1: Check if exists in Redis
    const cached = await this.redis.get(key);
    if (cached) {
      // Already in cache, return from Redis
      return JSON.parse(cached) as Companies;
    }

    // Step 2: Not in cache, get from DB
    const company = await this.repo.findOne({ where: { id } });

    // Step 3: Cache in Redis
    if (company) {
      await this.redis.setex(key, 3600, JSON.stringify(company));

      // Step 4: Fetch from Redis to ensure consistency
      const redisCached = await this.redis.get(key);
      return JSON.parse(redisCached!) as Companies;
    }

    return company;
  }

  // ---------------- UPDATE ----------------
  async update(id: number, data: Partial<Companies>) {
    // Step 1: Update in DB
    await this.repo.update(id, data);

    // Step 2: Get updated company from DB
    const company = await this.repo.findOne({ where: { id } });

    if (company) {
      // Step 3: Update cache in Redis
      const key = `company:${id}`;
      await this.redis.setex(key, 3600, JSON.stringify(company));

      // Step 4: Fetch from Redis to ensure consistency
      const cached = await this.redis.get(key);
      return JSON.parse(cached!) as Companies;
    }

    return company;
  }

  // ---------------- DELETE ----------------
  async delete(id: number) {
    // Step 1: Delete from DB
    await this.repo.delete(id);

    // Step 2: Remove from Redis cache
    await this.redis.del(`company:${id}`);

    return { deleted: true };
  }
}
