import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ActivityLogs } from 'src/entities/entities/ActivityLogs';
import { Repository } from 'typeorm';

@Injectable()
export class ActivityLogsService {
  constructor(
    @InjectRepository(ActivityLogs)
    private repo: Repository<ActivityLogs>,
  ) {}

  async logForbiddenAccess(data: {
    userId?: number;
    username?: string;
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
}
