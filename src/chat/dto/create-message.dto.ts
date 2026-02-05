import {
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
  IsOptional,
  IsObject,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentType } from '../schemas/message.schema';
import { MessageMentionDto } from './send-message.dto';

/**
 * Attachment type values for validation
 */
export const ATTACHMENT_TYPES = Object.values(AttachmentType);

/**
 * DTO for message attachment
 */
export class MessageAttachmentDto {
  @IsEnum(AttachmentType)
  type: AttachmentType;

  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  originalFilename: string;

  @IsNumber()
  size: number;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @IsOptional()
  duration?: number;

  @IsArray()
  @IsOptional()
  waveform?: number[];

  @IsNumber()
  @IsOptional()
  width?: number;

  @IsNumber()
  @IsOptional()
  height?: number;
}

/**
 * Internal DTO for creating a message in the database.
 * Used by ChatService - separate from WebSocket DTO which includes tempId.
 */
export class CreateMessageDto {
  @IsNumber()
  @IsNotEmpty()
  recipientId: number;

  @IsString()
  @MaxLength(2000)
  content: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageAttachmentDto)
  attachment?: MessageAttachmentDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageMentionDto)
  mentions?: MessageMentionDto[];
}
