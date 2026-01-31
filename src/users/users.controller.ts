import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserService } from './users.service';
import { avatarUploadOptions } from './avatar-upload.config';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import * as bcrypt from 'bcrypt';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { ApiResponse } from 'src/common/utils/api-response';

/**
 * Controller for managing users and their roles.
 *
 * All routes are protected by JWT and most are further restricted by role.
 */
@UseGuards(AuthGuard('jwt'))
@ApiTags('user')
@ApiBearerAuth('JWT')
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * Get a paginated list of users visible to the current user.
   *
   * @param req - Authenticated request containing the current user.
   * @param includeInactive - If `'true'`, include inactive users in the result.
   * @returns API response with the list of users.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin', 'manager')
  @Get('getAll')
  async findAll(
    @Req() req: RequestWithUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const includeInactiveFlag = includeInactive === 'true';
    const data = await this.userService.findAllWithAccess(
      req.user,
      includeInactiveFlag,
    );
    return ApiResponse.success('Users retrieved successfully', 200, data);
  }

  /**
   * Get a user by ID with access control checks.
   *
   * @param req - Authenticated request used for access context and logging.
   * @param id - Numeric user identifier.
   * @returns API response with the requested user, if accessible.
   */
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

  /**
   * Get a user by email with access control checks.
   *
   * @param req - Authenticated request used for access context and logging.
   * @param email - Email address of the user to fetch.
   * @returns API response with the requested user, if accessible.
   * @throws NotFoundException when the user does not exist.
   */
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

  /**
   * Create a new user.
   *
   * Password is required and will be hashed before saving.
   *
   * @param req - Authenticated request providing the acting user.
   * @param body - User creation payload.
   * @returns API response with the created user.
   * @throws BadRequestException if password is missing.
   */
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

  /**
   * Update an existing user by ID.
   *
   * @param req - Authenticated request providing the acting user.
   * @param id - ID of the user to update.
   * @param body - Partial user data to update.
   * @returns API response with the updated user.
   */
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

  /**
   * Delete a user by ID.
   *
   * @param req - Authenticated request providing the acting user.
   * @param id - ID of the user to delete.
   * @returns API response indicating successful deletion.
   */
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('company_admin', 'super_admin')
  @Delete('delete/:id')
  async remove(@Req() req: RequestWithUser, @Param('id') id: number) {
    const data = await this.userService.delete(+id, req.user);
    return ApiResponse.success('User deleted successfully', 200, data);
  }

  /**
   * Assign secondary roles to a user.
   *
   * @param req - Authenticated request providing the acting user.
   * @param id - Target user ID.
   * @param body - DTO containing role slugs to assign.
   * @returns API response with updated user roles.
   */
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

  /**
   * Remove a secondary role from a user.
   *
   * @param req - Authenticated request providing the acting user.
   * @param id - Target user ID.
   * @param slug - Role slug to remove.
   * @returns API response with updated user roles.
   */
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

  /**
   * Activate or deactivate a user.
   * - super_admin: can change company_admin, manager, user (not other super_admin)
   * - company_admin: can change manager, user in their company (not super_admin or company_admin)
   *
   * @param req - Authenticated request providing the acting user.
   * @param id - Target user ID.
   * @param body - DTO specifying the desired active status.
   * @returns API response with the updated user status.
   */
  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'company_admin')
  @ApiOperation({ summary: 'Activate or deactivate a user' })
  async updateUserStatus(
    @Req() req: RequestWithUser,
    @Param('id') id: number,
    @Body() body: UpdateUserStatusDto,
  ) {
    const data = await this.userService.setUserActiveStatus(
      req.user,
      +id,
      body.isActive,
      {
        ipAddress: req.ip,
        method: req.method,
        api: req.originalUrl,
      },
    );
    const statusText = body.isActive ? 'activated' : 'deactivated';
    return ApiResponse.success(`User ${statusText} successfully`, 200, data);
  }

  /**
   * Get the profile of the currently authenticated user.
   *
   * Always fetches fresh data from the database instead of relying on JWT payload.
   *
   * @param req - Authenticated request providing the current user.
   * @returns API response with the user profile.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  async getUserData(@Req() req: RequestWithUser) {
    // Fetch fresh user data from database instead of JWT
    const data = await this.userService.findOne(req.user.id);
    return ApiResponse.success(
      'User profile retrieved successfully',
      200,
      data,
    );
  }

  /**
   * Self-update profile for the currently authenticated user.
   *
   * Allows updating `firstname`, `lastname`, and optionally `password`
   * (requires `currentPassword` verification).
   *
   * @param req - Authenticated request providing the current user.
   * @param body - Partial update DTO plus optional `currentPassword`.
   * @returns API response with the updated profile.
   */
  @UseGuards(AuthGuard('jwt'))
  @Put('profile')
  async updateProfile(
    @Req() req: RequestWithUser,
    @Body() body: UpdateUserDto & { currentPassword?: string },
  ) {
    // Users can only update their own firstname, lastname, and password
    const allowedFields: Partial<UpdateUserDto> = {};
    if (body.firstname !== undefined) allowedFields.firstname = body.firstname;
    if (body.lastname !== undefined) allowedFields.lastname = body.lastname;

    // If password is being changed, verify current password first
    if (body.password !== undefined) {
      if (!body.currentPassword) {
        throw new BadRequestException('Current password is required');
      }

      const isValid = await this.userService.verifyPassword(
        req.user.id,
        body.currentPassword,
      );

      if (!isValid) {
        throw new BadRequestException('Current password is incorrect');
      }

      allowedFields.password = body.password;
    }

    const data = await this.userService.update(
      req.user,
      req.user.id,
      allowedFields,
      {
        ipAddress: req.ip,
        method: req.method,
        api: req.originalUrl,
      },
    );
    return ApiResponse.success('Profile updated successfully', 200, data);
  }

  /**
   * Upload or update profile picture for the currently authenticated user.
   *
   * @param req - Authenticated request providing the current user.
   * @param file - Uploaded image file.
   * @returns API response with the updated user including new profile picture URL.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('profile/avatar')
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', avatarUploadOptions))
  async uploadAvatar(
    @Req() req: RequestWithUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const data = await this.userService.updateProfilePicture(
      req.user.id,
      file.filename,
    );
    return ApiResponse.success(
      'Profile picture uploaded successfully',
      200,
      data,
    );
  }

  /**
   * Remove profile picture for the currently authenticated user.
   *
   * @param req - Authenticated request providing the current user.
   * @returns API response with the updated user.
   */
  @UseGuards(AuthGuard('jwt'))
  @Delete('profile/avatar')
  @ApiOperation({ summary: 'Remove profile picture' })
  async removeAvatar(@Req() req: RequestWithUser) {
    const data = await this.userService.removeProfilePicture(req.user.id);
    return ApiResponse.success(
      'Profile picture removed successfully',
      200,
      data,
    );
  }
}
