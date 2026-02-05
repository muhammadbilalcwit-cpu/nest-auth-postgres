import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Conversation Schema
 *
 * Represents a chat conversation (1-on-1 or group).
 * - participants: Array of PostgreSQL user IDs
 * - lastMessage: Preview of the last message sent
 * - lastMessageAt: When the last message was sent (for sorting)
 * - deletedFor: Array of user IDs who have soft-deleted this conversation
 *
 * Group-specific fields:
 * - isGroup: Distinguishes group from 1-on-1 chat
 * - groupName: Display name for the group
 * - groupAvatar: URL for group picture
 * - groupAdmin: Manager who created/manages the group
 * - companyId: Company this group belongs to
 */
@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({ required: true, type: [Number] })
  participants: number[]; // PostgreSQL user IDs

  @Prop({ type: String, default: null })
  lastMessage: string | null;

  @Prop({ type: Number, default: null })
  lastMessageSenderId: number | null;

  @Prop({ type: Date, default: null })
  lastMessageAt: Date | null;

  @Prop({ type: [Number], default: [] })
  deletedFor: number[]; // User IDs who have soft-deleted this conversation

  // ─── Group Chat Fields ─────────────────────────────────────────────────────

  @Prop({ type: Boolean, default: false })
  isGroup: boolean;

  @Prop({ type: String, default: null })
  groupName: string | null;

  @Prop({ type: String, default: null })
  groupAvatar: string | null;

  @Prop({ type: Number, default: null })
  groupAdmin: number | null; // Manager who created the group

  @Prop({ type: Number, default: null })
  companyId: number | null; // Company this group belongs to

  @Prop({ type: Map, of: Date, default: {} })
  memberJoinedAt: Map<string, Date>; // Maps memberId (as string) to join timestamp

  // System message metadata for lastMessage (to display "you" in previews)
  @Prop({ type: String, default: null })
  lastMessageSystemType: string | null; // e.g., 'member_added', 'member_left'

  @Prop({ type: Number, default: null })
  lastMessageTargetUserId: number | null; // The user who was added/removed/left

  @Prop({ type: Number, default: null })
  lastMessageActorUserId: number | null; // The user who performed the action
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Index for fast lookup by participants
ConversationSchema.index({ participants: 1 });

// Index for sorting by last message time
ConversationSchema.index({ lastMessageAt: -1 });

// Index for filtering out deleted conversations
ConversationSchema.index({ deletedFor: 1 });

// Index for group queries
ConversationSchema.index({ isGroup: 1, companyId: 1 });

// Index for finding groups by admin
ConversationSchema.index({ groupAdmin: 1 });
