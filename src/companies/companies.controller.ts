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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiResponse } from 'src/common/utils/api-response';
import { AuthUser } from '../common/interfaces/auth-user.interface';

/**
 * Controller for managing companies.
 *
 * All routes require JWT authentication and are typically restricted
 * to super administrators.
 */
@UseGuards(AuthGuard('jwt'))
@ApiTags('companies')
@ApiBearerAuth('JWT')
@Controller('companies')
export class CompaniesController {
  constructor(private service: CompaniesService) {}

  /**
   * Get all companies visible to the current user.
   *
   * @param req - Authenticated request containing the current user.
   * @returns API response with the list of companies.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Get('getAll')
  async findAll(@Req() req: { user: AuthUser }) {
    const data = await this.service.findAllWithAccess(req.user);
    return ApiResponse.success('Companies retrieved successfully', 200, data);
  }

  /**
   * Get a company by its ID.
   *
   * @param id - Company identifier.
   * @returns API response with the requested company.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Get('getById/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return ApiResponse.success('Company retrieved successfully', 200, data);
  }

  /**
   * Create a new company.
   *
   * @param dto - Company creation payload.
   * @param req - Authenticated request providing the acting user.
   * @returns API response with the created company.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Post('create')
  async create(@Body() dto: CreateCompanyDto, @Req() req: { user: AuthUser }) {
    const data = await this.service.create(dto, req.user);
    return ApiResponse.success('Company created successfully', 201, data);
  }

  /**
   * Update an existing company.
   *
   * @param id - Company identifier.
   * @param dto - Partial company update payload.
   * @param req - Authenticated request providing the acting user.
   * @returns API response with the updated company.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Put('update/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyDto,
    @Req() req: { user: AuthUser },
  ) {
    const data = await this.service.update(id, dto, req.user);
    return ApiResponse.success('Company updated successfully', 200, data);
  }

  /**
   * Delete a company by ID.
   *
   * @param id - Company identifier.
   * @param req - Authenticated request providing the acting user.
   * @returns API response indicating successful deletion.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Delete('delete/:id')
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: AuthUser },
  ) {
    const data = await this.service.delete(id, req.user);
    return ApiResponse.success('Company deleted successfully', 200, data);
  }
}
