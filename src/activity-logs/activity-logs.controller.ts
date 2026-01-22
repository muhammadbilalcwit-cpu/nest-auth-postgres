import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivityLogsService } from './activity-logs.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { ApiResponse } from '../common/utils/api-response';

/**
 * Controller for querying user activity logs.
 *
 * All routes are JWT-protected and intended for administrative users.
 */
@UseGuards(AuthGuard('jwt'))
@ApiTags('activity-logs')
@ApiBearerAuth('JWT')
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private readonly activityLogsService: ActivityLogsService) {}

  /**
   * Get a paginated list of activity logs visible to the current user.
   *
   * @param req - Authenticated request providing the current user.
   * @param page - Page number (defaults to 1).
   * @param limit - Page size (defaults to 20).
   * @param method - Optional HTTP method filter.
   * @param search - Optional free-text search filter.
   * @returns API response with paginated activity logs.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Get('getAll')
  async findAll(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('method') method?: string,
    @Query('search') search?: string,
  ) {
    const result = await this.activityLogsService.findAllWithAccess(req.user, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      method,
      search,
    });
    return ApiResponse.success(
      'Activity logs retrieved successfully',
      200,
      result,
    );
  }

  /**
   * Get activity logs for a specific user.
   *
   * @param req - Authenticated request providing the current user.
   * @param userId - Target user ID.
   * @returns API response with the user's activity logs.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Get('user/:userId')
  async findByUser(
    @Req() req: RequestWithUser,
    @Param('userId') userId: number,
  ) {
    const data = await this.activityLogsService.findByUser(+userId);
    return ApiResponse.success(
      'Activity logs retrieved successfully',
      200,
      data,
    );
  }
}
