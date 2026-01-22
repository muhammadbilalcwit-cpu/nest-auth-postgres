import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ActivityLogs } from 'src/entities/entities/ActivityLogs';
import { Repository } from 'typeorm';
import { AuthUser } from 'src/common/interfaces/auth-user.interface';

export interface PaginationParams {
  page?: number;
  limit?: number;
  method?: string;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class ActivityLogsService {
  constructor(
    @InjectRepository(ActivityLogs)
    private repo: Repository<ActivityLogs>,
  ) {}

  async logForbiddenAccess(data: {
    userId?: number;
    username?: string;
    companyId?: number;
    ipAddress: string;
    api: string;
    method: string;
  }) {
    const log = this.repo.create({
      ...data,
      reason: 'FORBIDDEN',
    });

    await this.repo.save(log);
  }

  // Get paginated logs with filters
  async findAllPaginated(
    params: PaginationParams,
    companyId?: number,
  ): Promise<PaginatedResult<ActivityLogs>> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const queryBuilder = this.repo.createQueryBuilder('log');

    // Filter by company if provided (for company_admin)
    if (companyId) {
      queryBuilder.andWhere('log.companyId = :companyId', { companyId });
    }

    // Filter by HTTP method
    if (params.method) {
      queryBuilder.andWhere('log.method = :method', { method: params.method });
    }

    // Search in username, api, reason
    if (params.search) {
      queryBuilder.andWhere(
        '(log.username ILIKE :search OR log.api ILIKE :search OR log.reason ILIKE :search)',
        { search: `%${params.search}%` },
      );
    }

    // Order by createdAt DESC
    queryBuilder.orderBy('log.createdAt', 'DESC');

    // Get total count before pagination
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    const data = await queryBuilder.getMany();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get logs by user
  async findByUser(userId: number) {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // Get paginated logs with access control based on requester role
  async findAllWithAccess(
    requester: AuthUser,
    params: PaginationParams,
  ): Promise<PaginatedResult<ActivityLogs>> {
    const roles = (requester.roles || []).map((r: string) =>
      String(r).toLowerCase().trim(),
    );

    // super_admin sees all logs
    if (roles.includes('super_admin')) {
      return this.findAllPaginated(params);
    }

    // company_admin sees only their company's logs
    if (roles.includes('company_admin')) {
      if (!requester.companyId) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: params.limit || 20, totalPages: 0 },
        };
      }
      return this.findAllPaginated(params, requester.companyId);
    }

    // Others see no logs
    return {
      data: [],
      meta: { total: 0, page: 1, limit: params.limit || 20, totalPages: 0 },
    };
  }
}
