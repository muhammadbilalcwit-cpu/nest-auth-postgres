import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from 'src/common/utils/api-response';
import { AuthUser } from '../common/interfaces/auth-user.interface';

@UseGuards(AuthGuard('jwt'))
@ApiTags('departments')
@ApiBearerAuth('JWT')
@Controller('departments')
export class DepartmentsController {
  constructor(private service: DepartmentsService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  async findAll(@Req() req: { user: AuthUser }) {
    const data = await this.service.findAllWithAccess(req.user);
    return ApiResponse.success('Departments retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getById/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return ApiResponse.success('Department retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getByCompany/:companyId')
  async findByCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    const data = await this.service.findByCompany(companyId);
    return ApiResponse.success('Departments retrieved successfully', 200, data);
  }

  // Protected create - company_admin or super_admin
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Post('create')
  async create(
    @Body() dto: CreateDepartmentDto,
    @Req() req: { user: AuthUser },
  ) {
    const data = await this.service.create(dto, req.user);
    return ApiResponse.success('Department created successfully', 201, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Put('update/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
    @Req() req: { user: AuthUser },
  ) {
    const data = await this.service.update(id, dto, req.user);
    return ApiResponse.success('Department updated successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Delete('delete/:id')
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: AuthUser },
  ) {
    const data = await this.service.delete(id, req.user);
    return ApiResponse.success('Department deleted successfully', 200, data);
  }
}
