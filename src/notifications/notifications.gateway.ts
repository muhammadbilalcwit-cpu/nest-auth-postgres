import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departments } from '../entities/entities/Departments';
import { Users } from '../entities/entities/Users';
import { Sessions } from '../entities/entities/Sessions';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import * as cookie from 'cookie';
import * as UAParser from 'ua-parser-js';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto';
import {
  NotificationPayload,
  UserStatusPayload,
  JwtPayload,
  SessionEventPayload,
  SessionExpiredPayload,
} from './interfaces';

// Re-export for backward compatibility
export {
  NotificationPayload,
  UserStatusPayload,
  SessionInfo,
  SessionEventPayload,
  SessionExpiredPayload,
} from './interfaces';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  // Map to track which company each socket belongs to
  private socketCompanyMap: Map<string, number> = new Map();
  // Map to track which user each socket belongs to
  private socketUserMap: Map<string, number> = new Map();
  // Map to track ALL socket IDs for a user (supports multiple tabs)
  private userSocketsMap: Map<number, Set<string>> = new Map();
  // Map to track which session each socket belongs to
  private socketSessionMap: Map<string, number> = new Map();
  // Map to track ALL socket IDs for a session (supports multiple tabs in same session)
  private sessionSocketsMap: Map<number, Set<string>> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(Departments)
    private readonly departmentsRepo: Repository<Departments>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(Sessions)
    private readonly sessionsRepo: Repository<Sessions>,
    @Inject('REDIS_PUB_CLIENT')
    private readonly redisPubClient: Redis,
    @Inject('REDIS_SUB_CLIENT')
    private readonly redisSubClient: Redis,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  async afterInit(server: Server) {
    // Set up Redis adapter for horizontal scaling
    const adapter = createAdapter(this.redisPubClient, this.redisSubClient);
    server.adapter(adapter);

    // Clear stale online users on server startup
    const clearedKeys = await this.notificationsService.clearAllOnlineUsers();
    console.log(
      `WebSocket Gateway initialized with Redis Pub/Sub adapter (cleared ${clearedKeys} stale keys)`,
    );
  }

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from cookies
      const cookies = client.handshake.headers.cookie;
      if (!cookies) {
        console.log(`WebSocket: No cookies found, disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      const parsedCookies = cookie.parse(cookies);
      const token = parsedCookies.accessToken;

      if (!token) {
        console.log(
          `WebSocket: No accessToken in cookies, disconnecting ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (!payload || !payload.sub) {
        console.log(`WebSocket: Invalid token, disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      const userId = payload.sub;

      // Get company directly from JWT payload (single source of truth)
      let companyId: number | null = payload.companyId || null;

      // Fallback: Get company from department if companyId not in payload
      if (!companyId && payload.departmentId) {
        const dept = await this.departmentsRepo.findOne({
          where: { id: payload.departmentId },
          relations: ['company'],
        });
        companyId = dept?.company?.id || null;
      }

      if (!companyId) {
        console.log(
          `WebSocket: User ${userId} has no company, disconnecting ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Get sessionId from JWT payload
      const sessionId = payload.sessionId || null;

      // Store mappings
      this.socketCompanyMap.set(client.id, companyId);
      this.socketUserMap.set(client.id, userId);

      // Track sessionId for this socket
      if (sessionId) {
        this.socketSessionMap.set(client.id, sessionId);

        // Track multiple sockets per session (multiple tabs from same login)
        const sessionSockets =
          this.sessionSocketsMap.get(sessionId) || new Set<string>();
        sessionSockets.add(client.id);
        this.sessionSocketsMap.set(sessionId, sessionSockets);
      }

      // Track multiple sockets per user (for multiple tabs)
      const userSockets = this.userSocketsMap.get(userId) || new Set<string>();
      const isFirstConnection = userSockets.size === 0;
      userSockets.add(client.id);
      this.userSocketsMap.set(userId, userSockets);

      // Join company room
      const roomName = `company:${companyId}`;
      void client.join(roomName);

      // If user is super_admin, also join the super_admins room for cross-company updates
      if (payload.roles?.includes('super_admin')) {
        void client.join('super_admins');
        console.log(
          `WebSocket: Super admin ${userId} joined super_admins room`,
        );
      }

      // Only mark user as online in Redis on FIRST connection
      if (isFirstConnection) {
        await this.notificationsService.markUserOnline(userId, companyId);

        // Emit user-online event to company room for real-time status updates
        const user = await this.usersRepo.findOne({
          where: { id: userId },
          select: ['id', 'email', 'firstname', 'lastname'],
        });

        if (user) {
          const statusPayload: UserStatusPayload = {
            userId: user.id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            isOnline: true,
            companyId,
          };
          // Emit to company room and super_admins room
          this.server.to(roomName).emit('user-status-changed', statusPayload);
          this.server
            .to('super_admins')
            .emit('user-status-changed', statusPayload);
        }
      }

      // Emit session-added event for real-time session tracking (even if user is already online)
      // This is the FIRST socket for this session
      if (sessionId) {
        const sessionSockets = this.sessionSocketsMap.get(sessionId);
        const isFirstSocketForSession =
          sessionSockets && sessionSockets.size === 1;

        if (isFirstSocketForSession) {
          // Fetch session details from database
          const session = await this.sessionsRepo.findOne({
            where: { id: sessionId },
          });

          if (session) {
            const user = await this.usersRepo.findOne({
              where: { id: userId },
              select: ['id', 'email', 'firstname', 'lastname'],
            });

            if (user) {
              const { browser, os } = this.parseUserAgent(session.userAgent);
              const sessionPayload: SessionEventPayload = {
                sessionId: session.id,
                userId: user.id,
                email: user.email,
                firstname: user.firstname,
                lastname: user.lastname,
                browser,
                os,
                ipAddress: session.ipAddress,
                loginAt: session.loginAt,
                lastActivityAt: session.lastActivityAt,
                companyId,
              };

              // Emit to company room and super_admins for real-time session updates
              this.server.to(roomName).emit('session-added', sessionPayload);
              this.server
                .to('super_admins')
                .emit('session-added', sessionPayload);
              console.log(
                `WebSocket: Emitted session-added for session ${sessionId} (user ${userId})`,
              );
            }
          }
        }
      }

      console.log(
        `WebSocket: User ${userId} (${payload.email}) connected to room ${roomName}`,
      );

      // Fetch and emit unread notifications from database
      const unreadNotifications =
        await this.notificationsService.getUnreadNotifications(userId);
      const unreadCount = unreadNotifications.length;

      if (unreadCount > 0) {
        client.emit('unread-notifications', {
          notifications: unreadNotifications,
          count: unreadCount,
        });
        console.log(
          `WebSocket: Sent ${unreadCount} unread notifications to user ${userId}`,
        );
      }

      // Also emit the unread count separately
      client.emit('unread-count', { count: unreadCount });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.log(
        `WebSocket: Authentication failed for ${client.id}:`,
        errorMessage,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const companyId = this.socketCompanyMap.get(client.id);
    const userId = this.socketUserMap.get(client.id);
    const sessionId = this.socketSessionMap.get(client.id);

    // Clean up socket-level mappings
    this.socketCompanyMap.delete(client.id);
    this.socketUserMap.delete(client.id);
    this.socketSessionMap.delete(client.id);

    // Clean up session socket tracking and emit session-removed if last socket for session
    if (sessionId) {
      const sessionSockets = this.sessionSocketsMap.get(sessionId);
      if (sessionSockets) {
        sessionSockets.delete(client.id);
        if (sessionSockets.size === 0) {
          this.sessionSocketsMap.delete(sessionId);

          // Emit session-removed event when session has no more connections
          if (userId && companyId) {
            const roomName = `company:${companyId}`;
            const sessionRemovedPayload = { sessionId, userId, companyId };
            this.server
              .to(roomName)
              .emit('session-removed', sessionRemovedPayload);
            this.server
              .to('super_admins')
              .emit('session-removed', sessionRemovedPayload);
            console.log(
              `WebSocket: Emitted session-removed for session ${sessionId} (user ${userId})`,
            );
          }
        }
      }
    }

    if (userId && companyId) {
      // Remove this socket from user's socket set
      const userSockets = this.userSocketsMap.get(userId);
      if (userSockets) {
        userSockets.delete(client.id);

        // Only mark user as offline when ALL their sockets are closed
        if (userSockets.size === 0) {
          this.userSocketsMap.delete(userId);
          await this.notificationsService.markUserOffline(userId, companyId);

          // Emit user-offline event to company room for real-time status updates
          const user = await this.usersRepo.findOne({
            where: { id: userId },
            select: ['id', 'email', 'firstname', 'lastname'],
          });

          if (user) {
            const statusPayload: UserStatusPayload = {
              userId: user.id,
              email: user.email,
              firstname: user.firstname,
              lastname: user.lastname,
              isOnline: false,
              companyId,
            };
            const roomName = `company:${companyId}`;
            // Emit to company room and super_admins room
            this.server.to(roomName).emit('user-status-changed', statusPayload);
            this.server
              .to('super_admins')
              .emit('user-status-changed', statusPayload);
          }

          console.log(
            `WebSocket: User ${userId} fully disconnected from company:${companyId}`,
          );
        } else {
          console.log(
            `WebSocket: User ${userId} closed one tab, ${userSockets.size} connection(s) remaining`,
          );
        }
      }
    }
  }

  /**
   * Handle mark-read event from client
   */
  @SubscribeMessage('mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: number },
  ) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    const success = await this.notificationsService.markAsRead(
      userId,
      data.notificationId,
    );
    const newUnreadCount =
      await this.notificationsService.getUnreadCount(userId);

    // Emit updated unread count
    client.emit('unread-count', { count: newUnreadCount });

    return { success, unreadCount: newUnreadCount };
  }

  /**
   * Handle mark-all-read event from client
   */
  @SubscribeMessage('mark-all-read')
  async handleMarkAllRead(@ConnectedSocket() client: Socket) {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) return;

    const count = await this.notificationsService.markAllAsRead(userId);

    // Emit updated unread count
    client.emit('unread-count', { count: 0 });

    return { markedCount: count, unreadCount: 0 };
  }

  /**
   * Create and emit notification to a company
   * This is the main method to be called from other services
   */
  async emitNotification(dto: CreateNotificationDto): Promise<void> {
    // Create notification in database and get online users
    const { notification, onlineUserIds } =
      await this.notificationsService.createNotification(dto);

    // Build notification payload
    const payload: NotificationPayload = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      actorId: notification.actorId,
      actorEmail: notification.actorEmail,
      createdAt: notification.createdAt,
      isRead: false,
    };

    // Emit to all online users in the company via Socket.io
    const roomName = `company:${dto.companyId}`;
    this.server.to(roomName).emit('notification', payload);

    console.log(
      `WebSocket: Emitted "${notification.type}" to room ${roomName} (${onlineUserIds.length} online users)`,
    );
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use emitNotification instead
   */
  emitToCompany(
    companyId: number,
    notification: {
      type: string;
      message: string;
      data?: unknown;
      performedBy: { id: number; email: string };
      timestamp: string;
    },
  ) {
    // Convert to new format and emit
    this.emitNotification({
      companyId,
      type: notification.type,
      title: notification.type
        .replace(':', ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase()),
      message: notification.message,
      data: notification.data as object,
      actorId: notification.performedBy.id,
      actorEmail: notification.performedBy.email,
    }).catch((err) => {
      console.error('Failed to emit notification:', err);
    });
  }

  /**
   * Get connected clients count for a company
   */
  async getCompanyClientsCount(companyId: number): Promise<number> {
    const roomName = `company:${companyId}`;
    const sockets = await this.server.in(roomName).fetchSockets();
    return sockets.length;
  }

  /**
   * Check if a user is currently connected
   */
  isUserConnected(userId: number): boolean {
    const sockets = this.userSocketsMap.get(userId);
    return sockets !== undefined && sockets.size > 0;
  }

  /**
   * Get all socket IDs for a user
   */
  getUserSocketIds(userId: number): string[] {
    const sockets = this.userSocketsMap.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Get connection count for a user
   */
  getUserConnectionCount(userId: number): number {
    const sockets = this.userSocketsMap.get(userId);
    return sockets ? sockets.size : 0;
  }

  /**
   * Force disconnect a user (all their sockets)
   * Used for session revocation
   */
  async forceDisconnectUser(userId: number): Promise<number> {
    const sockets = this.userSocketsMap.get(userId);
    if (!sockets || sockets.size === 0) {
      return 0;
    }

    const companyId = this.socketUserMap.get(Array.from(sockets)[0])
      ? this.socketCompanyMap.get(Array.from(sockets)[0])
      : undefined;

    let disconnectedCount = 0;
    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force-disconnect', { reason: 'Session revoked by admin' });
        socket.disconnect(true);
        disconnectedCount++;
      }
    }

    // Clean up
    this.userSocketsMap.delete(userId);
    if (companyId) {
      await this.notificationsService.markUserOffline(userId, companyId);

      // Emit user-offline event to company room
      const user = await this.usersRepo.findOne({
        where: { id: userId },
        select: ['id', 'email', 'firstname', 'lastname'],
      });

      if (user) {
        const statusPayload: UserStatusPayload = {
          userId: user.id,
          email: user.email,
          firstname: user.firstname,
          lastname: user.lastname,
          isOnline: false,
          companyId,
        };
        const roomName = `company:${companyId}`;
        // Emit to company room and super_admins room
        this.server.to(roomName).emit('user-status-changed', statusPayload);
        this.server
          .to('super_admins')
          .emit('user-status-changed', statusPayload);
      }
    }

    console.log(
      `WebSocket: Force disconnected user ${userId} (${disconnectedCount} sockets)`,
    );
    return disconnectedCount;
  }

  /**
   * Force disconnect all users in a company (except the admin who triggered it)
   * Used for "Revoke All Sessions" feature
   */
  async forceDisconnectAllCompanyUsers(
    companyId: number,
    excludeUserId?: number,
  ): Promise<{ disconnectedUsers: number; disconnectedSockets: number }> {
    const roomName = `company:${companyId}`;
    const socketsInRoom = await this.server.in(roomName).fetchSockets();

    let disconnectedUsers = 0;
    let disconnectedSockets = 0;
    const processedUsers = new Set<number>();

    for (const socket of socketsInRoom) {
      const userId = this.socketUserMap.get(socket.id);
      if (!userId || userId === excludeUserId) continue;

      // Emit force-disconnect event
      socket.emit('force-disconnect', {
        reason: 'All sessions revoked by admin',
      });
      socket.disconnect(true);
      disconnectedSockets++;

      // Track unique users
      if (!processedUsers.has(userId)) {
        processedUsers.add(userId);
        disconnectedUsers++;

        // Clean up user tracking
        this.userSocketsMap.delete(userId);
        await this.notificationsService.markUserOffline(userId, companyId);

        // Emit user-offline event
        const user = await this.usersRepo.findOne({
          where: { id: userId },
          select: ['id', 'email', 'firstname', 'lastname'],
        });

        if (user) {
          const statusPayload: UserStatusPayload = {
            userId: user.id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            isOnline: false,
            companyId,
          };
          // Emit to company room and super_admins room
          this.server.to(roomName).emit('user-status-changed', statusPayload);
          this.server
            .to('super_admins')
            .emit('user-status-changed', statusPayload);
        }
      }
    }

    console.log(
      `WebSocket: Force disconnected all users in company:${companyId} (${disconnectedUsers} users, ${disconnectedSockets} sockets)`,
    );

    return { disconnectedUsers, disconnectedSockets };
  }

  /**
   * Parse user agent string to get browser and OS info
   */
  parseUserAgent(userAgent: string | null): { browser: string; os: string } {
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
   * Force disconnect a specific session (by sessionId)
   * Used when admin revokes a specific session
   */
  async forceDisconnectSession(
    sessionId: number,
    userId: number,
    companyId: number,
  ): Promise<number> {
    const sessionSockets = this.sessionSocketsMap.get(sessionId);
    if (!sessionSockets || sessionSockets.size === 0) {
      return 0;
    }

    let disconnectedCount = 0;
    for (const socketId of sessionSockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('force-disconnect', { reason: 'Session revoked by admin' });
        socket.disconnect(true);
        disconnectedCount++;
      }

      // Clean up mappings
      this.socketCompanyMap.delete(socketId);
      this.socketUserMap.delete(socketId);
      this.socketSessionMap.delete(socketId);

      // Remove from user sockets
      const userSockets = this.userSocketsMap.get(userId);
      if (userSockets) {
        userSockets.delete(socketId);
      }
    }

    // Clean up session sockets map
    this.sessionSocketsMap.delete(sessionId);

    // Emit session-removed event for real-time UI updates
    const roomName = `company:${companyId}`;
    const sessionRemovedPayload = { sessionId, userId, companyId };
    this.server.to(roomName).emit('session-removed', sessionRemovedPayload);
    this.server
      .to('super_admins')
      .emit('session-removed', sessionRemovedPayload);

    // Check if user still has other connections
    const remainingUserSockets = this.userSocketsMap.get(userId);
    if (!remainingUserSockets || remainingUserSockets.size === 0) {
      this.userSocketsMap.delete(userId);
      await this.notificationsService.markUserOffline(userId, companyId);

      // Emit user-offline event
      const user = await this.usersRepo.findOne({
        where: { id: userId },
        select: ['id', 'email', 'firstname', 'lastname'],
      });

      if (user) {
        const statusPayload: UserStatusPayload = {
          userId: user.id,
          email: user.email,
          firstname: user.firstname,
          lastname: user.lastname,
          isOnline: false,
          companyId,
        };
        const roomName = `company:${companyId}`;
        this.server.to(roomName).emit('user-status-changed', statusPayload);
        this.server
          .to('super_admins')
          .emit('user-status-changed', statusPayload);
      }
    }

    console.log(
      `WebSocket: Force disconnected session ${sessionId} (${disconnectedCount} sockets)`,
    );
    return disconnectedCount;
  }

  /**
   * Get all session IDs for a user
   */
  getUserSessionIds(userId: number): number[] {
    const userSockets = this.userSocketsMap.get(userId);
    if (!userSockets) return [];

    const sessionIds = new Set<number>();
    for (const socketId of userSockets) {
      const sessionId = this.socketSessionMap.get(socketId);
      if (sessionId) {
        sessionIds.add(sessionId);
      }
    }
    return Array.from(sessionIds);
  }

  /**
   * Check if a specific session is connected
   */
  isSessionConnected(sessionId: number): boolean {
    const sockets = this.sessionSocketsMap.get(sessionId);
    return sockets !== undefined && sockets.size > 0;
  }

  /**
   * Emit session-expired event to specific sessions
   * Used when sessions are invalidated by cron job or admin action
   */
  emitSessionExpired(
    sessionIds: number[],
    reason: 'expired' | 'revoked' | 'logout',
    message: string,
  ): number {
    let notifiedCount = 0;

    for (const sessionId of sessionIds) {
      const sessionSockets = this.sessionSocketsMap.get(sessionId);
      if (!sessionSockets || sessionSockets.size === 0) continue;

      const payload: SessionExpiredPayload = {
        sessionId,
        reason,
        message,
      };

      for (const socketId of sessionSockets) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('session-expired', payload);
          notifiedCount++;
        }
      }
    }

    if (notifiedCount > 0) {
      console.log(
        `WebSocket: Emitted session-expired to ${notifiedCount} socket(s) for ${sessionIds.length} session(s)`,
      );
    }

    return notifiedCount;
  }

  /**
   * Emit session-expired to all sessions of a user
   */
  emitUserSessionsExpired(
    userId: number,
    reason: 'expired' | 'revoked' | 'logout',
    message: string,
  ): number {
    const sessionIds = this.getUserSessionIds(userId);
    return this.emitSessionExpired(sessionIds, reason, message);
  }
}
