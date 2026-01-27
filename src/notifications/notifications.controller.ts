import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { ApiResponse } from '../common/utils/api-response';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { SessionsService } from '../sessions/sessions.service';

@UseGuards(AuthGuard('jwt'))
@ApiTags('notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly sessionsService: SessionsService,
  ) {}

  /**
   * Get all notifications for the current user (paginated)
   */
  @Get()
  @ApiOperation({ summary: 'Get all notifications for current user' })
  async getNotifications(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const data = await this.notificationsService.getUserNotifications(
      req.user.id,
      pageNum,
      limitNum,
    );

    return ApiResponse.success(
      'Notifications retrieved successfully',
      200,
      data,
    );
  }

  /**
   * Get unread notifications for the current user
   */
  @Get('unread')
  @ApiOperation({ summary: 'Get unread notifications for current user' })
  async getUnreadNotifications(@Req() req: RequestWithUser) {
    const notifications =
      await this.notificationsService.getUnreadNotifications(req.user.id);
    const count = notifications.length;

    return ApiResponse.success(
      'Unread notifications retrieved successfully',
      200,
      {
        notifications,
        count,
      },
    );
  }

  /**
   * Get unread notification count for the current user
   */
  @Get('unread/count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(@Req() req: RequestWithUser) {
    const count = await this.notificationsService.getUnreadCount(req.user.id);

    return ApiResponse.success('Unread count retrieved successfully', 200, {
      count,
    });
  }

  /**
   * Mark a specific notification as read
   */
  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const success = await this.notificationsService.markAsRead(req.user.id, id);
    const newUnreadCount = await this.notificationsService.getUnreadCount(
      req.user.id,
    );

    if (success) {
      return ApiResponse.success('Notification marked as read', 200, {
        notificationId: id,
        unreadCount: newUnreadCount,
      });
    }

    return ApiResponse.success('Notification already read or not found', 200, {
      notificationId: id,
      unreadCount: newUnreadCount,
    });
  }

  /**
   * Mark all notifications as read for the current user
   */
  @Patch('read/all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@Req() req: RequestWithUser) {
    const count = await this.notificationsService.markAllAsRead(req.user.id);

    return ApiResponse.success('All notifications marked as read', 200, {
      markedCount: count,
      unreadCount: 0,
    });
  }

  // ==================== COMPANY ADMIN ENDPOINTS ====================

  /**
   * Helper to check if user is company_admin
   */
  private isCompanyAdmin(req: RequestWithUser): boolean {
    return (
      req.user.roles?.includes('company_admin') ||
      req.user.roles?.includes('super_admin')
    );
  }

  /**
   * Get all online users for the company (company_admin only)
   */
  @Get('admin/online-users')
  @ApiOperation({
    summary: 'Get online users for company (company_admin only)',
  })
  async getOnlineUsers(@Req() req: RequestWithUser) {
    if (!this.isCompanyAdmin(req)) {
      throw new ForbiddenException('Only company admins can access this');
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      throw new ForbiddenException('User has no company assigned');
    }

    const onlineUsers =
      await this.notificationsService.getOnlineUsersWithDetails(companyId);

    return ApiResponse.success('Online users retrieved successfully', 200, {
      onlineUsers,
      count: onlineUsers.length,
    });
  }

  /**
   * Get ONLY online users with their sessions (company_admin only)
   * Shows active sessions for each online user with browser/OS details
   */
  @Get('admin/users-status')
  @ApiOperation({
    summary: 'Get online users with sessions (company_admin only)',
  })
  async getCompanyUsersStatus(@Req() req: RequestWithUser) {
    if (!this.isCompanyAdmin(req)) {
      throw new ForbiddenException('Only company admins can access this');
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      throw new ForbiddenException('User has no company assigned');
    }

    const users =
      await this.notificationsService.getOnlineUsersWithSessions(companyId);
    const totalSessions = users.reduce((sum, u) => sum + u.sessions.length, 0);

    return ApiResponse.success(
      'Online users with sessions retrieved successfully',
      200,
      {
        users,
        onlineUsers: users.length,
        totalSessions,
      },
    );
  }

  /**
   * Revoke ALL sessions for a user (company_admin only)
   * This will:
   * 1. Invalidate all their sessions in the database
   * 2. Force disconnect all their WebSocket connections
   */
  @Post('admin/revoke-session/:userId')
  @ApiOperation({ summary: 'Revoke all user sessions (company_admin only)' })
  async revokeUserSession(
    @Req() req: RequestWithUser,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    if (!this.isCompanyAdmin(req)) {
      throw new ForbiddenException('Only company admins can access this');
    }

    // Prevent revoking own session
    if (req.user.id === userId) {
      throw new ForbiddenException('Cannot revoke your own session');
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      throw new ForbiddenException('User has no company assigned');
    }

    // Invalidate all sessions for this user in the database
    await this.sessionsService.invalidateAllUserSessions(userId);

    // Force disconnect their WebSocket connections
    const disconnectedCount =
      await this.notificationsGateway.forceDisconnectUser(userId);

    return ApiResponse.success('All user sessions revoked successfully', 200, {
      userId,
      sessionsInvalidated: true,
      socketsDisconnected: disconnectedCount,
    });
  }

  /**
   * Revoke a SPECIFIC session by sessionId (company_admin only)
   * This will:
   * 1. Invalidate the specific session in the database
   * 2. Force disconnect WebSocket connections for that session only
   */
  @Post('admin/revoke-specific-session/:sessionId')
  @ApiOperation({ summary: 'Revoke specific session (company_admin only)' })
  async revokeSpecificSession(
    @Req() req: RequestWithUser,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    if (!this.isCompanyAdmin(req)) {
      throw new ForbiddenException('Only company admins can access this');
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      throw new ForbiddenException('User has no company assigned');
    }

    // Get the session to verify it belongs to the same company
    const session = await this.sessionsService.getSessionById(sessionId);
    if (!session) {
      throw new ForbiddenException('Session not found');
    }

    // Prevent revoking own session
    if (session.userId === req.user.id) {
      throw new ForbiddenException('Cannot revoke your own session');
    }

    // Invalidate this specific session in the database
    await this.sessionsService.invalidateSessionById(sessionId);

    // Force disconnect WebSocket connections for this session
    const disconnectedCount =
      await this.notificationsGateway.forceDisconnectSession(
        sessionId,
        session.userId,
        companyId,
      );

    return ApiResponse.success('Session revoked successfully', 200, {
      sessionId,
      userId: session.userId,
      socketsDisconnected: disconnectedCount,
    });
  }

  /**
   * Revoke all user sessions in the company (company_admin only)
   * This will disconnect all online users except the admin who triggered it
   */
  @Post('admin/revoke-all-sessions')
  @ApiOperation({ summary: 'Revoke all user sessions (company_admin only)' })
  async revokeAllSessions(@Req() req: RequestWithUser) {
    if (!this.isCompanyAdmin(req)) {
      throw new ForbiddenException('Only company admins can access this');
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      throw new ForbiddenException('User has no company assigned');
    }

    // Force disconnect all WebSocket connections (except the admin)
    const { disconnectedUsers, disconnectedSockets } =
      await this.notificationsGateway.forceDisconnectAllCompanyUsers(
        companyId,
        req.user.id,
      );

    // Invalidate all sessions for users in this company (except admin)
    const invalidatedSessions =
      await this.sessionsService.invalidateAllCompanySessions(
        companyId,
        req.user.id,
      );

    return ApiResponse.success('All sessions revoked successfully', 200, {
      companyId,
      usersDisconnected: disconnectedUsers,
      socketsDisconnected: disconnectedSockets,
      sessionsInvalidated: invalidatedSessions,
    });
  }

  // ==================== SUPER ADMIN ENDPOINTS ====================

  /**
   * Helper to check if user is super_admin
   */
  private isSuperAdmin(req: RequestWithUser): boolean {
    return req.user.roles?.includes('super_admin') ?? false;
  }

  /**
   * Get all companies with their user status (super_admin only)
   */
  @Get('admin/companies-status')
  @ApiOperation({
    summary: 'Get all companies with user status (super_admin only)',
  })
  async getAllCompaniesStatus(@Req() req: RequestWithUser) {
    if (!this.isSuperAdmin(req)) {
      throw new ForbiddenException('Only super admins can access this');
    }

    const companies =
      await this.notificationsService.getAllCompaniesWithUserStatus();

    const totalOnline = companies.reduce((sum, c) => sum + c.onlineCount, 0);
    const totalUsers = companies.reduce((sum, c) => sum + c.totalUsers, 0);

    return ApiResponse.success(
      'All companies with status retrieved successfully',
      200,
      {
        companies,
        totalCompanies: companies.length,
        totalUsers,
        totalOnline,
        totalOffline: totalUsers - totalOnline,
      },
    );
  }

  /**
   * Get ONLY online users with sessions for a specific company (super_admin only)
   */
  @Get('admin/company/:companyId/users-status')
  @ApiOperation({
    summary: 'Get online users with sessions for a company (super_admin only)',
  })
  async getCompanyUsersStatusById(
    @Req() req: RequestWithUser,
    @Param('companyId', ParseIntPipe) companyId: number,
  ) {
    if (!this.isSuperAdmin(req)) {
      throw new ForbiddenException('Only super admins can access this');
    }

    const data =
      await this.notificationsService.getOnlineUsersWithSessionsById(companyId);
    const totalSessions = data.users.reduce(
      (sum, u) => sum + u.sessions.length,
      0,
    );

    return ApiResponse.success(
      'Online users with sessions retrieved successfully',
      200,
      {
        company: data.company,
        users: data.users,
        onlineUsers: data.users.length,
        totalSessions,
      },
    );
  }

  /**
   * Revoke all sessions for a specific company (super_admin only)
   */
  @Post('admin/company/:companyId/revoke-all-sessions')
  @ApiOperation({
    summary: 'Revoke all sessions for a company (super_admin only)',
  })
  async revokeAllSessionsForCompany(
    @Req() req: RequestWithUser,
    @Param('companyId', ParseIntPipe) companyId: number,
  ) {
    if (!this.isSuperAdmin(req)) {
      throw new ForbiddenException('Only super admins can access this');
    }

    // Force disconnect all WebSocket connections for this company
    const { disconnectedUsers, disconnectedSockets } =
      await this.notificationsGateway.forceDisconnectAllCompanyUsers(companyId);

    // Invalidate all sessions for users in this company
    const invalidatedSessions =
      await this.sessionsService.invalidateAllCompanySessions(companyId);

    return ApiResponse.success(
      'All sessions revoked for company successfully',
      200,
      {
        companyId,
        usersDisconnected: disconnectedUsers,
        socketsDisconnected: disconnectedSockets,
        sessionsInvalidated: invalidatedSessions,
      },
    );
  }

  /**
   * Revoke a specific session by sessionId (super_admin only)
   */
  @Post('admin/company/:companyId/revoke-session/:sessionId')
  @ApiOperation({
    summary: 'Revoke specific session (super_admin only)',
  })
  async revokeSpecificSessionForCompany(
    @Req() req: RequestWithUser,
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    if (!this.isSuperAdmin(req)) {
      throw new ForbiddenException('Only super admins can access this');
    }

    // Get the session to verify it exists
    const session = await this.sessionsService.getSessionById(sessionId);
    if (!session) {
      throw new ForbiddenException('Session not found');
    }

    // Invalidate this specific session in the database
    await this.sessionsService.invalidateSessionById(sessionId);

    // Force disconnect WebSocket connections for this session
    const disconnectedCount =
      await this.notificationsGateway.forceDisconnectSession(
        sessionId,
        session.userId,
        companyId,
      );

    return ApiResponse.success('Session revoked successfully', 200, {
      sessionId,
      userId: session.userId,
      companyId,
      socketsDisconnected: disconnectedCount,
    });
  }
}
