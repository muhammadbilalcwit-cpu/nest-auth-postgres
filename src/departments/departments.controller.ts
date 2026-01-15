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
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from 'src/common/utils/api-response';

@UseGuards(AuthGuard('jwt'))
@ApiTags('departments')
@ApiBearerAuth('JWT')
@Controller('departments')
export class DepartmentsController {
  constructor(private service: DepartmentsService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  findAll() {
    const data = this.service.findAll();
    return ApiResponse.success('Departments retrieved successfully', 200, data);
  }
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getById/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    const data = this.service.findOne(id);
    return ApiResponse.success('Department retrieved successfully', 200, data);
  }

  // Protected create - company_admin or super_admin
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Post('create')
  create(@Body() dto: CreateDepartmentDto) {
    const data = this.service.create(dto);
    return ApiResponse.success('Department created successfully', 201, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Put('update/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDepartmentDto,
  ) {
    const data = this.service.update(id, dto);
    return ApiResponse.success('Department updated successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Delete('delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    const data = this.service.delete(id);
    return ApiResponse.success('Department deleted successfully', 200, data);
  }
}
