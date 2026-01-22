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

/**
 * Controller for managing departments within companies.
 *
 * Routes are JWT-protected and typically restricted to company admins,
 * super admins and managers.
 */
@UseGuards(AuthGuard('jwt'))
@ApiTags('departments')
@ApiBearerAuth('JWT')
@Controller('departments')
export class DepartmentsController {
  constructor(private service: DepartmentsService) {}

  /**
   * Get all departments visible to the current user.
   *
   * @param req - Authenticated request providing the current user.
   * @returns API response with the list of departments.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  async findAll(@Req() req: { user: AuthUser }) {
    const data = await this.service.findAllWithAccess(req.user);
    return ApiResponse.success('Departments retrieved successfully', 200, data);
  }

  /**
   * Get a department by its ID.
   *
   * @param id - Department identifier.
   * @returns API response with the requested department.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getById/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return ApiResponse.success('Department retrieved successfully', 200, data);
  }

  /**
   * Get all departments belonging to a specific company.
   *
   * @param companyId - Company identifier.
   * @returns API response with the list of departments for the company.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getByCompany/:companyId')
  async findByCompany(@Param('companyId', ParseIntPipe) companyId: number) {
    const data = await this.service.findByCompany(companyId);
    return ApiResponse.success('Departments retrieved successfully', 200, data);
  }

  /**
   * Create a new department.
   *
   * @param dto - Department creation payload.
   * @param req - Authenticated request providing the acting user.
   * @returns API response with the created department.
   */
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

  /**
   * Update an existing department.
   *
   * @param id - Department identifier.
   * @param dto - Partial update payload.
   * @param req - Authenticated request providing the acting user.
   * @returns API response with the updated department.
   */
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

  /**
   * Delete a department by ID.
   *
   * @param id - Department identifier.
   * @param req - Authenticated request providing the acting user.
   * @returns API response indicating successful deletion.
   */
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
