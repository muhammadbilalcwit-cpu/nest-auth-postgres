import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserService } from './users.service';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import * as bcrypt from 'bcrypt';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { ApiResponse } from 'src/common/utils/api-response';

@UseGuards(AuthGuard('jwt'))
@ApiTags('user')
@ApiBearerAuth('JWT')
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  async findAll(@Req() req: RequestWithUser) {
    const data = await this.userService.findAllWithAccess(req.user);
    return ApiResponse.success('Users retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager', 'user')
  @Get('getById/:id')
  async findById(@Req() req: RequestWithUser, @Param('id') id: number) {
    const data = await this.userService.findOneWithAccess(id, req.user, {
      ipAddress: req.ip,
      method: req.method,
      api: req.originalUrl,
    });
    return ApiResponse.success('User retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getByEmail/:email')
  async findByEmail(
    @Req() req: RequestWithUser,
    @Param('email') email: string,
  ) {
    const u = await this.userService.findByEmail(email);
    if (!u) throw new NotFoundException('User not found');

    const data = await this.userService.findOneWithAccess(u.id, req.user, {
      ipAddress: req.ip,
      method: req.method,
      api: req.originalUrl,
    });
    return ApiResponse.success('User retrieved successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Post('create')
  async create(@Req() req: RequestWithUser, @Body() body: CreateUserDto) {
    if (!body.password) {
      throw new BadRequestException('Password is required');
    }
    const hashed = await bcrypt.hash(body.password, 10); // Hash the password
    body.password = hashed;
    const data = await this.userService.create(req.user, body, {
      ipAddress: req.ip,
      method: req.method,
      api: req.originalUrl,
    });
    return ApiResponse.success('User created successfully', 201, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Put('update/:id')
  async update(
    @Req() req: RequestWithUser,
    @Param('id') id: number,
    @Body() body: UpdateUserDto,
  ) {
    const data = await this.userService.update(req.user, +id, body, {
      ipAddress: req.ip,
      method: req.method,
      api: req.originalUrl,
    });
    return ApiResponse.success('User updated successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Delete('delete/:id')
  remove(@Param('id') id: number) {
    const data = this.userService.delete(+id);
    return ApiResponse.success('User deleted successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @Post(':id/assignRoles')
  async assignRoles(
    @Req() req: RequestWithUser,
    @Param('id') id: number,
    @Body() body: AssignRolesDto,
  ) {
    const data = await this.userService.assignSecondaryRoles(
      req.user,
      +id,
      body.roleSlugs,
      {
        ipAddress: req.ip,
        method: req.method,
        api: req.originalUrl,
      },
    );
    return ApiResponse.success('Roles assigned successfully', 200, data);
  }

  @Delete(':id/removeRoles/:slug')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  async removeRole(
    @Req() req: RequestWithUser,
    @Param('id') id: number,
    @Param('slug') slug: string,
  ) {
    const data = await this.userService.removeSecondaryRole(
      req.user,
      +id,
      slug,
      {
        ipAddress: req.ip,
        method: req.method,
        api: req.originalUrl,
      },
    );
    return ApiResponse.success('Role removed successfully', 200, data);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  getUserData(@Req() req) {
    const data = req.user;
    return ApiResponse.success(
      'User profile retrieved successfully',
      200,
      data,
    );
  }
}
