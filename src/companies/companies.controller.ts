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

@UseGuards(AuthGuard('jwt'))
@ApiTags('companies')
@ApiBearerAuth('JWT')
@Controller('companies')
export class CompaniesController {
  constructor(private service: CompaniesService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Get('getAll')
  async findAll(@Req() req: { user: AuthUser }) {
    const data = await this.service.findAllWithAccess(req.user);
    return ApiResponse.success('Companies retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Get('getById/:id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return ApiResponse.success('Company retrieved successfully', 200, data);
  }

  // Protected create - company_admin or super_admin
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @Post('create')
  async create(@Body() dto: CreateCompanyDto, @Req() req: { user: AuthUser }) {
    const data = await this.service.create(dto, req.user);
    return ApiResponse.success('Company created successfully', 201, data);
  }

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
