import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Redis } from 'ioredis';
import * as UAParser from 'ua-parser-js';
import { Notifications } from '../entities/entities/Notifications';
import { UserNotifications } from '../entities/entities/UserNotifications';
import { Users } from '../entities/entities/Users';
import { Companies } from '../entities/entities/Companies';
import { Sessions } from '../entities/entities/Sessions';
import { CreateNotificationDto } from './dto';
import {
  NotificationResponse,
  OnlineUserInfo,
  OnlineUserWithSessions,
} from './interfaces';

// Re-export for backward compatibility
export { CreateNotificationDto } from './dto';
export {
  NotificationResponse,
  OnlineUserInfo,
  SessionDetails,
  OnlineUserWithSessions,
} from './interfaces';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // Company-specific key format for online users
  private getOnlineUsersKey(companyId: number): string {
    return `online:company:${companyId}`;
  }

  constructor(
    @InjectRepository(Notifications)
    private readonly notificationsRepo: Repository<Notifications>,
    @InjectRepository(UserNotifications)
    private readonly userNotificationsRepo: Repository<UserNotifications>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(Companies)
    private readonly companiesRepo: Repository<Companies>,
    @InjectRepository(Sessions)
    private readonly sessionsRepo: Repository<Sessions>,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,
  ) {}

  /**
   * Mark user as online in Redis (company-specific SET)
   */
  async markUserOnline(userId: number, companyId: number): Promise<void> {
    const key = this.getOnlineUsersKey(companyId);
    await this.redisClient.sadd(key, userId.toString());
    this.logger.log(`User ${userId} marked as online in company ${companyId}`);
  }

  /**
   * Mark user as offline in Redis (company-specific SET)
   */
  async markUserOffline(userId: number, companyId: number): Promise<void> {
    const key = this.getOnlineUsersKey(companyId);
    await this.redisClient.srem(key, userId.toString());
    this.logger.log(`User ${userId} marked as offline in company ${companyId}`);
  }

  /**
   * Check if user is online in a specific company
   */
  async isUserOnline(userId: number, companyId: number): Promise<boolean> {
    const key = this.getOnlineUsersKey(companyId);
    const result = await this.redisClient.sismember(key, userId.toString());
    return result === 1;
  }

  /**
   * Get online users for a specific company (direct Redis lookup - no DB query needed)
   */
  async getOnlineUsersForCompany(companyId: number): Promise<number[]> {
    const key = this.getOnlineUsersKey(companyId);
    const userIds = await this.redisClient.smembers(key);
    return userIds.map((id) => parseInt(id, 10));
  }

  /**
   * Get online users with full details for a company (for company_admin)
   */
  async getOnlineUsersWithDetails(
    companyId: number,
  ): Promise<OnlineUserInfo[]> {
    const onlineUserIds = await this.getOnlineUsersForCompany(companyId);

    if (onlineUserIds.length === 0) {
      return [];
    }

    const users = await this.usersRepo.find({
      where: {
        id: In(onlineUserIds),
        company: { id: companyId },
      },
      select: ['id', 'email', 'firstname', 'lastname'],
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      isOnline: true,
    }));
  }

  /**
   * Get all company users with online status (for company_admin dashboard)
   */
  async getCompanyUsersWithStatus(
    companyId: number,
  ): Promise<OnlineUserInfo[]> {
    const onlineUserIds = await this.getOnlineUsersForCompany(companyId);
    const onlineSet = new Set(onlineUserIds);

    const users = await this.usersRepo.find({
      where: {
        company: { id: companyId },
        isActive: true,
        isDeleted: false,
      },
      select: ['id', 'email', 'firstname', 'lastname'],
      order: { email: 'ASC' },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      isOnline: onlineSet.has(user.id),
    }));
  }

  /**
   * Parse user agent string to get browser and OS info
   */
  private parseUserAgent(userAgent: string | null): {
    browser: string;
    os: string;
  } {
    if (!userAgent) {
      return { browser: 'Unknown', os: 'Unknown' };
    }

    const parser = new UAParser.UAParser(userAgent);
    const result = parser.getResult();

    const browser = result.browser.name
      ? `${result.browser.name}${result.browser.version ? ' ' + result.browser.version.split('.')[0] : ''}`
      : 'Unknown';

    const os = result.os.name
      ? `${result.os.name}${result.os.version ? ' ' + result.os.version : ''}`
      : 'Unknown';

    return { browser, os };
  }

  /**
   * Get ONLY online users with their active sessions (for active sessions page)
   */
  async getOnlineUsersWithSessions(
    companyId: number,
  ): Promise<OnlineUserWithSessions[]> {
    // Get online user IDs from Redis
    const onlineUserIds = await this.getOnlineUsersForCompany(companyId);

    if (onlineUserIds.length === 0) {
      return [];
    }

    // Get user details
    const users = await this.usersRepo.find({
      where: {
        id: In(onlineUserIds),
        company: { id: companyId },
        isActive: true,
        isDeleted: false,
      },
      select: ['id', 'email', 'firstname', 'lastname'],
      order: { email: 'ASC' },
    });

    // Get active sessions for these users from DB
    const sessions = await this.sessionsRepo.find({
      where: {
        userId: In(onlineUserIds),
        isValid: true,
      },
      order: { loginAt: 'DESC' },
    });

    // Group sessions by userId
    const sessionsByUser = new Map<number, Sessions[]>();
    for (const session of sessions) {
      const userSessions = sessionsByUser.get(session.userId) || [];
      userSessions.push(session);
      sessionsByUser.set(session.userId, userSessions);
    }

    // Build response with users and their sessions
    return users.map((user) => {
      const userSessions = sessionsByUser.get(user.id) || [];
      return {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        sessions: userSessions.map((session) => {
          const { browser, os } = this.parseUserAgent(session.userAgent);
          return {
            id: session.id,
            browser,
            os,
            ipAddress: session.ipAddress,
            loginAt: session.loginAt,
            lastActivityAt: session.lastActivityAt,
          };
        }),
      };
    });
  }

  /**
   * Get ONLY online users with their active sessions for a specific company (for super_admin drill-down)
   */
  async getOnlineUsersWithSessionsById(companyId: number): Promise<{
    company: { id: number; name: string };
    users: OnlineUserWithSessions[];
  }> {
    const company = await this.companiesRepo.findOne({
      where: { id: companyId },
    });

    if (!company) {
      return { company: { id: companyId, name: 'Unknown' }, users: [] };
    }

    const users = await this.getOnlineUsersWithSessions(companyId);

    return {
      company: { id: company.id, name: company.name },
      users,
    };
  }

  /**
   * Get all companies with their user status counts (for super_admin)
   */
  async getAllCompaniesWithUserStatus(): Promise<
    {
      id: number;
      name: string;
      totalUsers: number;
      onlineCount: number;
      offlineCount: number;
    }[]
  > {
    // Get all active companies
    const companies = await this.companiesRepo.find({
      where: { isDeleted: false },
      order: { name: 'ASC' },
    });

    const result = await Promise.all(
      companies.map(async (company) => {
        // Get total active users for this company
        const totalUsers = await this.usersRepo.count({
          where: {
            company: { id: company.id },
            isActive: true,
            isDeleted: false,
          },
        });

        // Get online users count from Redis
        const onlineUserIds = await this.getOnlineUsersForCompany(company.id);
        const onlineCount = onlineUserIds.length;

        return {
          id: company.id,
          name: company.name,
          totalUsers,
          onlineCount,
          offlineCount: totalUsers - onlineCount,
        };
      }),
    );

    return result;
  }

  /**
   * Get users with status for a specific company (for super_admin drill-down)
   */
  async getCompanyUsersWithStatusById(companyId: number): Promise<{
    company: { id: number; name: string };
    users: OnlineUserInfo[];
  }> {
    const company = await this.companiesRepo.findOne({
      where: { id: companyId },
    });

    if (!company) {
      return { company: { id: companyId, name: 'Unknown' }, users: [] };
    }

    const users = await this.getCompanyUsersWithStatus(companyId);

    return {
      company: { id: company.id, name: company.name },
      users,
    };
  }

  /**
   * Clear all online users for a company (used on server startup)
   */
  async clearOnlineUsersForCompany(companyId: number): Promise<void> {
    const key = this.getOnlineUsersKey(companyId);
    await this.redisClient.del(key);
    this.logger.log(`Cleared all online users for company ${companyId}`);
  }

  /**
   * Clear ALL online user data (used on server startup)
   */
  async clearAllOnlineUsers(): Promise<number> {
    const keys = await this.redisClient.keys('online:company:*');
    if (keys.length > 0) {
      await this.redisClient.del(...keys);
      this.logger.log(`Cleared ${keys.length} online user keys on startup`);
    }
    return keys.length;
  }

  /**
   * Create a notification and distribute to all company users
   * Returns the notification and list of online user IDs for real-time delivery
   */
  async createNotification(
    dto: CreateNotificationDto,
  ): Promise<{ notification: Notifications; onlineUserIds: number[] }> {
    // 1. Save notification to database
    const notification = this.notificationsRepo.create({
      companyId: dto.companyId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      data: dto.data || null,
      actorId: dto.actorId || null,
      actorEmail: dto.actorEmail || null,
    });

    const savedNotification = await this.notificationsRepo.save(notification);
    this.logger.log(
      `Notification ${savedNotification.id} created for company ${dto.companyId}`,
    );

    // 2. Get all active users in the company
    const companyUsers = await this.usersRepo.find({
      where: {
        company: { id: dto.companyId },
        isActive: true,
        isDeleted: false,
      },
      select: ['id'],
    });

    const userIds = companyUsers.map((u) => u.id);

    if (userIds.length === 0) {
      return { notification: savedNotification, onlineUserIds: [] };
    }

    // 3. Create user_notifications records for all users
    const userNotifications = userIds.map((userId) => ({
      userId,
      notificationId: savedNotification.id,
      isRead: false,
      deliveredAt: new Date(),
    }));

    await this.userNotificationsRepo.insert(userNotifications);
    this.logger.log(
      `Created ${userNotifications.length} user_notification records`,
    );

    // 4. Get online users for real-time delivery
    const onlineUserIds = await this.getOnlineUsersForCompany(dto.companyId);
    this.logger.log(
      `Online users in company ${dto.companyId}: ${onlineUserIds.length}`,
    );

    return { notification: savedNotification, onlineUserIds };
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadNotifications(
    userId: number,
  ): Promise<NotificationResponse[]> {
    const userNotifications = await this.userNotificationsRepo.find({
      where: {
        userId,
        isRead: false,
      },
      relations: ['notification'],
      order: {
        deliveredAt: 'DESC',
      },
    });

    return userNotifications.map((un) => ({
      id: un.notification.id,
      type: un.notification.type,
      title: un.notification.title,
      message: un.notification.message,
      data: un.notification.data,
      actorId: un.notification.actorId,
      actorEmail: un.notification.actorEmail,
      createdAt: un.notification.createdAt,
      isRead: un.isRead,
      readAt: un.readAt,
    }));
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: number): Promise<number> {
    return this.userNotificationsRepo.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  /**
   * Get all notifications for a user (with pagination)
   */
  async getUserNotifications(
    userId: number,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    notifications: NotificationResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [userNotifications, total] =
      await this.userNotificationsRepo.findAndCount({
        where: { userId },
        relations: ['notification'],
        order: { deliveredAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

    const notifications = userNotifications.map((un) => ({
      id: un.notification.id,
      type: un.notification.type,
      title: un.notification.title,
      message: un.notification.message,
      data: un.notification.data,
      actorId: un.notification.actorId,
      actorEmail: un.notification.actorEmail,
      createdAt: un.notification.createdAt,
      isRead: un.isRead,
      readAt: un.readAt,
    }));

    return { notifications, total, page, limit };
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(userId: number, notificationId: number): Promise<boolean> {
    const result = await this.userNotificationsRepo.update(
      { userId, notificationId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return (result.affected || 0) > 0;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: number): Promise<number> {
    const result = await this.userNotificationsRepo.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return result.affected || 0;
  }

  /**
   * Delete old notifications (cleanup job)
   */
  async deleteOldNotifications(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.notificationsRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }
}
