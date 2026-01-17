import { Controller, Get, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from 'src/common/utils/api-response';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';

@UseGuards(AuthGuard('jwt'))
@ApiTags('roles')
@ApiBearerAuth('JWT')
@Controller('roles')
export class RolesController {
  constructor(private service: RolesService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  async findAll() {
    const data = await this.service.findAll();
    return ApiResponse.success('Roles retrieved successfully', 200, data);
  }
}
