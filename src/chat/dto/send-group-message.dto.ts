import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsArray,
  IsOptional,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MessageMentionDto } from './send-message.dto';

/**
 * DTO for sending a message to a group via WebSocket
 * tempId is required for optimistic update reconciliation
 */
export class SendGroupMessageDto {
  @ApiProperty({
    description: 'Temporary client-side ID for optimistic updates',
    example: 'temp-1234567890-abc123',
  })
  @IsString()
  @IsNotEmpty()
  tempId: string;

  @ApiProperty({
    description: 'ID of the group conversation (MongoDB ObjectId)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({
    description: 'Message content',
    example: 'Hello team!',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    description: 'Array of user mentions in the message',
    type: [MessageMentionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageMentionDto)
  mentions?: MessageMentionDto[];

  @ApiPropertyOptional({
    description: 'Whether @all was used to mention all group members',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  mentionsAll?: boolean;
}
