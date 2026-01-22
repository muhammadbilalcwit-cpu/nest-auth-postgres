import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Sessions } from '../entities/entities/Sessions';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(Sessions)
    private sessionsRepository: Repository<Sessions>,
  ) {}

  /**
   * Hash refresh token for secure storage
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Create a new session when user logs in
   */
  async createSession(
    userId: number,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Sessions> {
    // Invalidate any existing valid sessions for this user (single session per user)
    await this.sessionsRepository.update(
      { userId, isValid: true },
      { isValid: false, updatedAt: new Date() },
    );

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
   * Cron job: Runs every minute (FOR TESTING - change back to EVERY_DAY_AT_MIDNIGHT for production)
   * Invalidates sessions that are older than 2 minutes from login time (FOR TESTING - change back to 12 hours)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredSessions(): Promise<void> {
    this.logger.log('Running session expiry cron job...');

    // FOR TESTING: 2 minutes ago (change back to 12 hours for production)
    // const twelveHoursAgo = new Date();
    // twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

    const twoMinutesAgo = new Date();
    twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);

    const result = await this.sessionsRepository.update(
      {
        isValid: true,
        loginAt: LessThan(twoMinutesAgo),
      },
      {
        isValid: false,
        updatedAt: new Date(),
      },
    );

    this.logger.log(
      `Expired ${result.affected || 0} sessions older than 2 minutes`,
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
}
