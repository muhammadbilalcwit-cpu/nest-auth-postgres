import { IsArray, IsNumber, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for adding members to a group
 * Only the group admin (manager) can add members
 */
export class AddGroupMembersDto {
  @ApiProperty({
    description: 'Array of user IDs to add to the group (PostgreSQL IDs)',
    example: [5, 6, 7],
    type: [Number],
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(1, { message: 'Must add at least 1 member' })
  memberIds: number[];
}
