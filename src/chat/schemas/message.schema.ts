import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Message Status Enum
 *
 * For 1-on-1 chats:
 * - sent: Message saved in database
 * - delivered: Message delivered to recipient (they received it)
 * - read: Recipient has read the message
 *
 * For group chats:
 * - sent: Message saved in database
 * - delivered: Message delivered to ALL members
 * - read: Message read by ALL members
 */
export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

/**
 * System Message Type Enum
 * WhatsApp-style system messages that appear inline in chat history
 */
export enum SystemMessageType {
  MEMBER_ADDED = 'member_added', // "Admin added John"
  MEMBER_REMOVED = 'member_removed', // "Admin removed John"
  MEMBER_LEFT = 'member_left', // "John left"
  ADMIN_CHANGED = 'admin_changed', // "John is now the new admin"
  GROUP_CREATED = 'group_created', // "Group created by Admin"
}

/**
 * Delivery/Read tracking for group messages
 * Tracks per-member status with timestamp
 */
export interface MemberStatus {
  userId: number;
  timestamp: Date;
}

/**
 * Attachment Type Enum
 * Types of attachments supported in chat messages
 */
export enum AttachmentType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  VOICE = 'voice',
}

/**
 * Attachment Interface
 * Metadata for file attachments in messages
 */
export interface MessageAttachment {
  type: AttachmentType;
  url: string;
  thumbnailUrl?: string; // For images/videos
  filename: string;
  originalFilename: string;
  size: number; // bytes
  mimeType: string;
  duration?: number; // seconds (for voice/video)
  waveform?: number[]; // Voice note visualization data
  width?: number; // Image/video dimensions
  height?: number;
}

/**
 * Mention Interface
 * Represents a user mention in a message
 */
export interface MessageMention {
  userId: number;
  displayName: string;
  position: number; // Start position in content string
  length: number; // Length of the mention in content
}

/**
 * Message Schema
 *
 * Represents a single chat message (1-on-1 or group).
 * - conversationId: Reference to the conversation
 * - senderId: PostgreSQL user ID of sender
 * - recipientId: PostgreSQL user ID of recipient (for 1-on-1 only)
 * - content: The message text
 * - status: Current delivery status (for 1-on-1, or aggregate for groups)
 *
 * Group-specific fields:
 * - isGroupMessage: Distinguishes group from 1-on-1 message
 * - deliveredTo: Array of {userId, timestamp} for per-member delivery tracking
 * - readBy: Array of {userId, timestamp} for per-member read tracking
 */
@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ required: true })
  senderId: number; // PostgreSQL user ID

  @Prop({ type: Number, default: null })
  recipientId: number | null; // PostgreSQL user ID (null for group messages)

  @Prop({ required: false, default: '' })
  content: string; // Can be empty for attachment-only messages

  @Prop({ type: String, enum: MessageStatus, default: MessageStatus.SENT })
  status: MessageStatus;

  @Prop({ type: Date, default: null })
  deliveredAt: Date | null;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean; // Deleted for everyone

  @Prop({ type: [Number], default: [] })
  deletedFor: number[]; // User IDs who deleted for themselves only

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  // ─── Group Message Fields ──────────────────────────────────────────────────

  @Prop({ type: Boolean, default: false })
  isGroupMessage: boolean;

  @Prop({
    type: [{ userId: Number, timestamp: Date }],
    default: [],
  })
  deliveredTo: MemberStatus[]; // Per-member delivery tracking

  @Prop({
    type: [{ userId: Number, timestamp: Date }],
    default: [],
  })
  readBy: MemberStatus[]; // Per-member read tracking

  // ─── System Message Fields ──────────────────────────────────────────────────

  @Prop({ type: Boolean, default: false })
  isSystemMessage: boolean; // True for system messages (member joined/left/removed)

  @Prop({
    type: String,
    enum: SystemMessageType,
    default: null,
  })
  systemMessageType: SystemMessageType | null;

  @Prop({ type: Number, default: null })
  targetUserId: number | null; // The user who was added/removed/left

  @Prop({ type: Number, default: null })
  actorUserId: number | null; // The user who performed the action (admin who added/removed)

  // ─── Attachment Fields ──────────────────────────────────────────────────────

  @Prop({
    type: {
      type: String,
      enum: AttachmentType,
    },
    url: String,
    thumbnailUrl: String,
    filename: String,
    originalFilename: String,
    size: Number,
    mimeType: String,
    duration: Number,
    waveform: [Number],
    width: Number,
    height: Number,
  })
  attachment: MessageAttachment | null;

  // ─── Mention Fields ──────────────────────────────────────────────────────────

  @Prop({
    type: [
      {
        userId: Number,
        displayName: String,
        position: Number,
        length: Number,
      },
    ],
    default: [],
  })
  mentions: MessageMention[];

  @Prop({ type: Boolean, default: false })
  mentionsAll: boolean; // True if @all was used in group message
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Index for fetching messages in a conversation (sorted by time)
MessageSchema.index({ conversationId: 1, createdAt: 1 });

// Index for fetching unread messages for a user (1-on-1 chats)
MessageSchema.index({ recipientId: 1, status: 1 });

// Index for fetching messages by sender
MessageSchema.index({ senderId: 1, createdAt: -1 });

// Index for filtering deleted messages
MessageSchema.index({ isDeleted: 1 });
MessageSchema.index({ deletedFor: 1 });

// Index for group message queries
MessageSchema.index({ isGroupMessage: 1, conversationId: 1 });

// Index for finding undelivered/unread group messages
MessageSchema.index({ 'deliveredTo.userId': 1 });
MessageSchema.index({ 'readBy.userId': 1 });

// Index for system messages
MessageSchema.index({ isSystemMessage: 1, conversationId: 1 });

// Index for attachment messages
MessageSchema.index({ 'attachment.type': 1, conversationId: 1 });

// Index for finding messages where a user was mentioned
MessageSchema.index({ 'mentions.userId': 1, conversationId: 1 });

// Index for @all mentions in groups
MessageSchema.index({ mentionsAll: 1, conversationId: 1 });
