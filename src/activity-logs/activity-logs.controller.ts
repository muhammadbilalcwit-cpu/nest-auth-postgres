import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivityLogsService } from './activity-logs.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { ApiResponse } from '../common/utils/api-response';

@UseGuards(AuthGuard('jwt'))
@ApiTags('activity-logs')
@ApiBearerAuth('JWT')
@Controller('activity-logs')
export class ActivityLogsController {
  constructor(private readonly activityLogsService: ActivityLogsService) {}

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
    return ApiResponse.success('Activity logs retrieved successfully', 200, result);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Get('user/:userId')
  async findByUser(
    @Req() req: RequestWithUser,
    @Param('userId') userId: number,
  ) {
    const data = await this.activityLogsService.findByUser(+userId);
    return ApiResponse.success('Activity logs retrieved successfully', 200, data);
  }
}
