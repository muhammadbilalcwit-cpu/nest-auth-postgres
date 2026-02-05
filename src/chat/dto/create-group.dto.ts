import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for creating a new group chat
 * Only managers can create groups
 */
export class CreateGroupDto {
  @ApiProperty({
    description: 'Name of the group',
    example: 'Team Alpha',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Array of user IDs to add as members (PostgreSQL IDs)',
    example: [2, 3, 4],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(1, {
    message: 'Group must have at least 1 member besides admin',
  })
  memberIds: number[];

  @ApiProperty({
    description: 'URL for group avatar image (optional)',
    example: 'https://example.com/avatar.png',
    required: false,
  })
  @IsOptional()
  @IsString()
  avatar?: string;
}
