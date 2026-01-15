import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class AssignRolesDto {
  @ApiPropertyOptional({ example: ['MANAGER'] })
  @IsArray()
  @IsString({ each: true })
  roleSlugs: string[];
}
