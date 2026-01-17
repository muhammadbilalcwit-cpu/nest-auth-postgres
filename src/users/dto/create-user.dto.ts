import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateUserDto {
  @ApiPropertyOptional({ example: 'new@gmail.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'newpassword' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  firstname?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastname?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  age?: number;

  @ApiPropertyOptional({ example: 'manager' })
  @IsOptional()
  @IsString()
  roleSlug?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  departmentId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  companyId?: number;
}
