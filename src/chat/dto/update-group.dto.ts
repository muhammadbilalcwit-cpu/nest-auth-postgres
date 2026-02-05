import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for updating group info
 * Only the group admin (manager) can update
 */
export class UpdateGroupDto {
  @ApiProperty({
    description: 'New name for the group',
    example: 'Team Beta',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description: 'URL for new group avatar image',
    example: 'https://example.com/new-avatar.png',
    required: false,
  })
  @IsOptional()
  @IsString()
  avatar?: string;
}
