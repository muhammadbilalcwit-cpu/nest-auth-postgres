import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Sessions } from '../entities/entities/Sessions';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(Sessions)
    private sessionsRepository: Repository<Sessions>,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Hash refresh token for secure storage
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Create a new session when user logs in
   * Allows multiple sessions per user (multi-device/browser support)
   */
  async createSession(
    userId: number,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Sessions> {
    const session = this.sessionsRepository.create({
      userId,
      refreshTokenHash: this.hashToken(refreshToken),
      loginAt: new Date(),
      lastActivityAt: new Date(),
      isValid: true,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    return this.sessionsRepository.save(session);
  }

  /**
   * Validate session by checking if it exists and is valid
   */
  async validateSession(
    userId: number,
    refreshToken: string,
  ): Promise<Sessions | null> {
    const tokenHash = this.hashToken(refreshToken);

    const session = await this.sessionsRepository.findOne({
      where: {
        userId,
        refreshTokenHash: tokenHash,
        isValid: true,
      },
    });

    if (session) {
      // Update last activity timestamp
      await this.sessionsRepository.update(session.id, {
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return session;
  }

  /**
   * Invalidate a specific session (logout)
   */
  async invalidateSession(userId: number, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);

    await this.sessionsRepository.update(
      { userId, refreshTokenHash: tokenHash },
      { isValid: false, updatedAt: new Date() },
    );
  }

  /**
   * Invalidate all sessions for a user
   */
  async invalidateAllUserSessions(userId: number): Promise<void> {
    await this.sessionsRepository.update(
      { userId, isValid: true },
      { isValid: false, updatedAt: new Date() },
    );
  }

  /**
   * Invalidate all sessions for users in a company (excluding a specific user)
   */
  async invalidateAllCompanySessions(
    companyId: number,
    excludeUserId?: number,
  ): Promise<number> {
    // Use query builder to join with users table and filter by company
    const queryBuilder = this.sessionsRepository
      .createQueryBuilder('sessions')
      .innerJoin('users', 'users', 'users.id = sessions.user_id')
      .innerJoin('departments', 'dept', 'dept.id = users.department_id')
      .where('dept.company_id = :companyId', { companyId })
      .andWhere('sessions.is_valid = :isValid', { isValid: true });

    if (excludeUserId) {
      queryBuilder.andWhere('sessions.user_id != :excludeUserId', {
        excludeUserId,
      });
    }

    // Get the session IDs to update
    const sessions = await queryBuilder
      .select('sessions.id')
      .getRawMany<{ sessions_id: number }>();
    const sessionIds = sessions.map((s) => s.sessions_id);

    if (sessionIds.length === 0) {
      return 0;
    }

    // Update all matching sessions
    const result = await this.sessionsRepository
      .createQueryBuilder()
      .update(Sessions)
      .set({ isValid: false, updatedAt: new Date() })
      .whereInIds(sessionIds)
      .execute();

    return result.affected || 0;
  }

  /**
   * Cron job: Runs every minute (FOR TESTING - change back to EVERY_DAY_AT_MIDNIGHT for production)
   * Invalidates sessions that are older than 30 minutes from login time (FOR TESTING - change back to 12 hours)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredSessions(): Promise<void> {
    this.logger.log('Running session expiry cron job...');

    // FOR TESTING: 30 minutes ago (change back to 12 hours for production)
    // const twelveHoursAgo = new Date();
    // twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

    const expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() - 30);

    // First, find sessions that will be expired (to notify them via WebSocket)
    const sessionsToExpire = await this.sessionsRepository.find({
      where: {
        isValid: true,
        loginAt: LessThan(expiryTime),
      },
      select: ['id'],
    });

    if (sessionsToExpire.length === 0) {
      this.logger.log('No sessions to expire');
      return;
    }

    const sessionIds = sessionsToExpire.map((s) => s.id);

    // Emit session-expired events to connected clients BEFORE invalidating
    const notifiedCount = this.notificationsGateway.emitSessionExpired(
      sessionIds,
      'expired',
      'Your session has expired. Please log in again.',
    );

    // Now invalidate the sessions
    const result = await this.sessionsRepository.update(
      {
        isValid: true,
        loginAt: LessThan(expiryTime),
      },
      {
        isValid: false,
        updatedAt: new Date(),
      },
    );

    this.logger.log(
      `Expired ${result.affected || 0} sessions (notified ${notifiedCount} connected clients)`,
    );
  }

  /**
   * Get active session count for a user
   */
  async getActiveSessionCount(userId: number): Promise<number> {
    return this.sessionsRepository.count({
      where: { userId, isValid: true },
    });
  }

  /**
   * Get all sessions for a user (for admin purposes)
   */
  async getUserSessions(userId: number): Promise<Sessions[]> {
    return this.sessionsRepository.find({
      where: { userId },
      order: { loginAt: 'DESC' },
    });
  }

  /**
   * Get active (valid) sessions for a user
   */
  async getActiveUserSessions(userId: number): Promise<Sessions[]> {
    return this.sessionsRepository.find({
      where: { userId, isValid: true },
      order: { loginAt: 'DESC' },
    });
  }

  /**
   * Get active sessions for multiple users
   */
  async getActiveSessionsForUsers(userIds: number[]): Promise<Sessions[]> {
    if (userIds.length === 0) {
      return [];
    }

    return this.sessionsRepository
      .createQueryBuilder('sessions')
      .where('sessions.user_id IN (:...userIds)', { userIds })
      .andWhere('sessions.is_valid = :isValid', { isValid: true })
      .orderBy('sessions.login_at', 'DESC')
      .getMany();
  }

  /**
   * Invalidate a specific session by ID
   */
  async invalidateSessionById(sessionId: number): Promise<Sessions | null> {
    const session = await this.sessionsRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      return null;
    }

    await this.sessionsRepository.update(sessionId, {
      isValid: false,
      updatedAt: new Date(),
    });

    return session;
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId: number): Promise<Sessions | null> {
    return this.sessionsRepository.findOne({
      where: { id: sessionId },
      relations: ['user'],
    });
  }

  /**
   * Update session with new refresh token hash
   */
  async updateSessionToken(
    sessionId: number,
    refreshToken: string,
  ): Promise<void> {
    await this.sessionsRepository.update(sessionId, {
      refreshTokenHash: this.hashToken(refreshToken),
      updatedAt: new Date(),
    });
  }
}
