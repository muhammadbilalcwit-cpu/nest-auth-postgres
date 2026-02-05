import {
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO for mentions in messages
 */
export class MessageMentionDto {
  @ApiProperty({ description: 'User ID being mentioned', example: 123 })
  @IsNumber()
  userId: number;

  @ApiProperty({
    description: 'Display name of the mentioned user',
    example: 'John Doe',
  })
  @IsString()
  displayName: string;

  @ApiProperty({ description: 'Position in content string', example: 4 })
  @IsNumber()
  position: number;

  @ApiProperty({ description: 'Length of mention in content', example: 19 })
  @IsNumber()
  length: number;
}

/**
 * DTO for sending a new message via WebSocket
 * tempId is required for optimistic update reconciliation
 */
export class SendMessageDto {
  @ApiProperty({
    description: 'Temporary client-side ID for optimistic updates',
    example: 'temp-1234567890-abc123',
  })
  @IsString()
  @IsNotEmpty()
  tempId: string;

  @ApiProperty({
    description: 'ID of the recipient user (from PostgreSQL)',
    example: 2,
  })
  @IsNumber()
  @IsNotEmpty()
  recipientId: number;

  @ApiProperty({
    description: 'Message content',
    example: 'Hello, how are you?',
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
}
