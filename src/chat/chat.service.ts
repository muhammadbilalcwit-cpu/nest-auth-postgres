import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Conversation } from './schemas/conversation.schema';
import {
  Message,
  MessageStatus,
  MemberStatus,
  SystemMessageType,
  MessageAttachment,
  MessageMention,
} from './schemas/message.schema';
import { Users } from '../entities/entities/Users';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddGroupMembersDto } from './dto/add-group-members.dto';

/**
 * Chat Service
 *
 * Handles all chat-related business logic:
 * - Access control (who can chat with whom)
 * - Creating/finding conversations
 * - Sending and storing messages
 * - Fetching chat history
 * - Marking messages as read
 */
@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
    @InjectModel(Message.name)
    private messageModel: Model<Message>,
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
  ) {}

  /**
   * Check if two users can chat with each other
   *
   * Rules:
   * - Must be in same department
   * - Manager can chat with anyone in department
   * - User can chat with other users + manager in department
   */
  async canUsersChat(userId1: number, userId2: number): Promise<boolean> {
    const [user1, user2] = await Promise.all([
      this.usersRepository.findOne({
        where: { id: userId1 },
        relations: ['userRoles', 'userRoles.role', 'department'],
      }),
      this.usersRepository.findOne({
        where: { id: userId2 },
        relations: ['userRoles', 'userRoles.role', 'department'],
      }),
    ]);

    if (!user1 || !user2) {
      return false;
    }

    // Must be in same department
    if (user1.department?.id !== user2.department?.id) {
      return false;
    }

    // Get role names
    const user1Roles =
      user1.userRoles?.map((ur) => ur.role?.name?.toLowerCase()) || [];
    const user2Roles =
      user2.userRoles?.map((ur) => ur.role?.name?.toLowerCase()) || [];

    // Admin cannot use chat (as per requirements)
    if (user1Roles.includes('admin') || user2Roles.includes('admin')) {
      return false;
    }

    // Manager can chat with anyone in department
    // User can chat with anyone in department (user or manager)
    return true;
  }

  /**
   * Get or create a conversation between two users
   */
  async getOrCreateConversation(
    userId1: number,
    userId2: number,
  ): Promise<Conversation> {
    // Check if users can chat
    const canChat = await this.canUsersChat(userId1, userId2);
    if (!canChat) {
      throw new ForbiddenException(
        'You are not allowed to chat with this user',
      );
    }

    // Sort IDs to ensure consistent lookup
    const participants = [userId1, userId2].sort((a, b) => a - b);

    // Find existing conversation
    let conversation = await this.conversationModel.findOne({
      participants: { $all: participants, $size: 2 },
    });

    // Create new if not exists
    if (!conversation) {
      conversation = await this.conversationModel.create({
        participants,
        lastMessage: null,
        lastMessageSenderId: null,
        lastMessageAt: null,
      });
    }

    return conversation;
  }

  /**
   * Send a new message
   */
  async sendMessage(
    senderId: number,
    dto: CreateMessageDto,
  ): Promise<{ message: Message; conversation: Conversation }> {
    // Get or create conversation
    const conversation = await this.getOrCreateConversation(
      senderId,
      dto.recipientId,
    );

    // Create message with optional attachment and mentions
    const message = await this.messageModel.create({
      conversationId: conversation._id,
      senderId,
      recipientId: dto.recipientId,
      content: dto.content,
      status: MessageStatus.SENT,
      attachment: dto.attachment || null,
      mentions: dto.mentions || [],
    });

    // Generate last message preview (WhatsApp-style attachment labels)
    let lastMessagePreview = dto.content;
    if (dto.attachment) {
      const attachmentLabels: Record<string, string> = {
        image: '📷 Photo',
        video: '🎥 Video',
        document: '📄 Document',
        voice: '🎤 Voice message',
      };
      const label = attachmentLabels[dto.attachment.type] || '📎 Attachment';
      lastMessagePreview = dto.content ? `${label}: ${dto.content}` : label;
    } else if (dto.content.length > 100) {
      lastMessagePreview = dto.content.substring(0, 100) + '...';
    }

    // Update conversation with last message and restore for both users (clear deletedFor)
    await this.conversationModel.findByIdAndUpdate(conversation._id, {
      lastMessage: lastMessagePreview,
      lastMessageSenderId: senderId,
      lastMessageAt: new Date(),
      deletedFor: [], // Restore conversation for both users when new message is sent
    });

    return { message, conversation };
  }

  /**
   * Get all 1:1 conversations for a user (excluding soft-deleted ones and groups)
   */
  async getUserConversations(userId: number): Promise<Conversation[]> {
    return this.conversationModel
      .find({
        participants: userId,
        deletedFor: { $ne: userId }, // Exclude conversations deleted by this user
        isGroup: { $ne: true }, // Exclude group conversations (only 1:1 chats)
      })
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  /**
   * Get messages in a conversation with pagination
   * For group chats: Only returns messages from after the user joined (WhatsApp behavior)
   */
  async getConversationMessages(
    conversationId: string,
    userId: number,
    page = 1,
    limit = 50,
  ): Promise<{ messages: Message[]; total: number; hasMore: boolean }> {
    // Verify user is part of conversation
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    const skip = (page - 1) * limit;

    // Build query filter
    const queryFilter: Record<string, unknown> = {
      conversationId: new Types.ObjectId(conversationId),
    };

    // For group chats: Only show messages from after the user joined (WhatsApp behavior)
    // This ensures re-added users don't see old messages
    if (conversation.isGroup && conversation.memberJoinedAt) {
      const userJoinedAt = conversation.memberJoinedAt.get(userId.toString());
      if (userJoinedAt) {
        queryFilter.createdAt = { $gte: userJoinedAt };
      }
    }

    const [messages, total] = await Promise.all([
      this.messageModel
        .find(queryFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.messageModel.countDocuments(queryFilter),
    ]);

    return {
      messages: messages.reverse(), // Return in chronological order
      total,
      hasMore: skip + messages.length < total,
    };
  }

  /**
   * Mark messages as delivered
   */
  async markAsDelivered(messageIds: string[], userId: number): Promise<number> {
    const result = await this.messageModel.updateMany(
      {
        _id: { $in: messageIds.map((id) => new Types.ObjectId(id)) },
        recipientId: userId,
        status: MessageStatus.SENT,
      },
      {
        status: MessageStatus.DELIVERED,
        deliveredAt: new Date(),
      },
    );

    return result.modifiedCount;
  }

  /**
   * Mark messages as read
   */
  async markAsRead(conversationId: string, userId: number): Promise<number> {
    const result = await this.messageModel.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        recipientId: userId,
        status: { $in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
      },
      {
        status: MessageStatus.READ,
        readAt: new Date(),
      },
    );

    return result.modifiedCount;
  }

  /**
   * Mark messages as read and return the senders who need to be notified
   * Used by ChatGateway to emit status updates to senders
   */
  async markAsReadAndGetSenders(
    conversationId: string,
    userId: number,
  ): Promise<{ messageIds: string[]; senderIds: number[] }> {
    // First, find the messages that will be marked as read
    const messagesToUpdate = await this.messageModel.find(
      {
        conversationId: new Types.ObjectId(conversationId),
        recipientId: userId,
        status: { $in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
      },
      { _id: 1, senderId: 1 },
    );

    if (messagesToUpdate.length === 0) {
      return { messageIds: [], senderIds: [] };
    }

    // Get unique sender IDs and message IDs
    const messageIds = messagesToUpdate.map((m) => m._id.toString());
    const senderIds = [...new Set(messagesToUpdate.map((m) => m.senderId))];

    // Update the messages to read status
    await this.messageModel.updateMany(
      {
        _id: { $in: messagesToUpdate.map((m) => m._id) },
      },
      {
        status: MessageStatus.READ,
        readAt: new Date(),
      },
    );

    return { messageIds, senderIds };
  }

  /**
   * Get unread message count for a user (1:1 chats only)
   */
  async getUnreadCount(userId: number): Promise<number> {
    return this.messageModel.countDocuments({
      recipientId: userId,
      status: { $in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
    });
  }

  /**
   * Get unread group message count for a user
   * Respects memberJoinedAt - only counts messages after user joined each group
   * Includes system messages (WhatsApp behavior - they DO count as unread)
   */
  async getGroupUnreadCount(userId: number): Promise<number> {
    // Find all groups the user is part of
    const groups = await this.conversationModel.find({
      participants: userId,
      isGroup: true,
      deletedFor: { $ne: userId },
    });

    if (groups.length === 0) {
      return 0;
    }

    // Count unread messages per group respecting memberJoinedAt
    let totalCount = 0;

    for (const group of groups) {
      const joinedAt = group.memberJoinedAt?.get(userId.toString());

      const matchCondition: Record<string, unknown> = {
        conversationId: group._id,
        isGroupMessage: true,
        senderId: { $ne: userId },
        'readBy.userId': { $ne: userId },
      };

      // Only count messages after user joined (WhatsApp behavior)
      if (joinedAt) {
        matchCondition.createdAt = { $gte: joinedAt };
      }

      const count = await this.messageModel.countDocuments(matchCondition);
      totalCount += count;
    }

    return totalCount;
  }

  /**
   * Get unread count per group for a user
   * Returns a Map of groupId -> unread count
   * Respects memberJoinedAt - only counts messages after user joined
   */
  async getGroupUnreadCounts(
    groupIds: string[],
    userId: number,
  ): Promise<Map<string, number>> {
    if (groupIds.length === 0) {
      return new Map();
    }

    // Get all groups to check memberJoinedAt timestamps
    const groups = await this.conversationModel.find({
      _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) },
    });

    // Create map of groupId -> memberJoinedAt
    const memberJoinedAtMap = new Map<string, Date | undefined>();
    for (const group of groups) {
      const joinedAt = group.memberJoinedAt?.get(userId.toString());
      memberJoinedAtMap.set(group._id.toString(), joinedAt);
    }

    // Count unread messages per group (with memberJoinedAt filter)
    const countMap = new Map<string, number>();

    // Process each group separately to respect memberJoinedAt
    for (const groupId of groupIds) {
      const joinedAt = memberJoinedAtMap.get(groupId);

      const matchCondition: Record<string, unknown> = {
        conversationId: new Types.ObjectId(groupId),
        isGroupMessage: true,
        senderId: { $ne: userId },
        'readBy.userId': { $ne: userId },
      };

      // Only count messages after user joined (WhatsApp behavior)
      if (joinedAt) {
        matchCondition.createdAt = { $gte: joinedAt };
      }

      const count = await this.messageModel.countDocuments(matchCondition);

      if (count > 0) {
        countMap.set(groupId, count);
      }
    }

    return countMap;
  }

  /**
   * Get total unread count (1:1 + groups)
   */
  async getTotalUnreadCount(
    userId: number,
  ): Promise<{ total: number; direct: number; groups: number }> {
    const [direct, groups] = await Promise.all([
      this.getUnreadCount(userId),
      this.getGroupUnreadCount(userId),
    ]);

    return {
      total: direct + groups,
      direct,
      groups,
    };
  }

  /**
   * Get unread count per conversation for a user
   */
  async getUnreadCountsByConversation(
    userId: number,
  ): Promise<Map<string, number>> {
    const unreadCounts = await this.messageModel.aggregate<{
      _id: { toString(): string };
      count: number;
    }>([
      {
        $match: {
          recipientId: userId,
          status: { $in: [MessageStatus.SENT, MessageStatus.DELIVERED] },
        },
      },
      {
        $group: {
          _id: '$conversationId',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map<string, number>();
    for (const item of unreadCounts) {
      countMap.set(item._id.toString(), item.count);
    }
    return countMap;
  }

  /**
   * Get all unread messages for a user (for when they come online)
   */
  async getUnreadMessages(userId: number): Promise<Message[]> {
    return this.messageModel
      .find({
        recipientId: userId,
        status: MessageStatus.SENT,
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Get pending (undelivered) messages for a user with conversation data
   * Called when user comes online to deliver messages they missed while offline
   */
  async getPendingMessagesForDelivery(userId: number): Promise<
    Array<{
      message: Message;
      conversation: Conversation;
      senderId: number;
    }>
  > {
    // Find all messages with status 'sent' for this recipient
    const pendingMessages = await this.messageModel
      .find({
        recipientId: userId,
        status: MessageStatus.SENT,
      })
      .sort({ createdAt: 1 })
      .exec();

    if (pendingMessages.length === 0) {
      return [];
    }

    // Get unique conversation IDs
    const conversationIds = [
      ...new Set(pendingMessages.map((m) => m.conversationId.toString())),
    ];

    // Fetch all conversations
    const conversations = await this.conversationModel
      .find({
        _id: { $in: conversationIds.map((id) => new Types.ObjectId(id)) },
      })
      .exec();

    // Create a map for quick lookup
    const conversationMap = new Map<string, Conversation>();
    for (const conv of conversations) {
      conversationMap.set(conv._id.toString(), conv);
    }

    // Return messages with their conversations
    const results: Array<{
      message: Message;
      conversation: Conversation;
      senderId: number;
    }> = [];

    for (const message of pendingMessages) {
      const conversation = conversationMap.get(
        message.conversationId.toString(),
      );
      if (conversation) {
        results.push({
          message,
          conversation,
          senderId: message.senderId,
        });
      }
    }

    return results;
  }

  /**
   * Soft delete a conversation for a user
   * The conversation will be hidden from this user but still visible to the other participant
   */
  async deleteConversation(
    conversationId: string,
    userId: number,
  ): Promise<{ deleted: boolean }> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Verify user is part of conversation
    if (!conversation.participants.includes(userId)) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    // Check if already deleted for this user
    if (conversation.deletedFor?.includes(userId)) {
      return { deleted: true };
    }

    // Add user to deletedFor array (soft delete)
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      $addToSet: { deletedFor: userId },
    });

    return { deleted: true };
  }

  /**
   * Restore a soft-deleted conversation for a user
   * Called automatically when a new message is received
   */
  async restoreConversation(
    conversationId: string,
    userId: number,
  ): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      $pull: { deletedFor: userId },
    });
  }

  /**
   * Delete a message for the current user only
   * The message will be hidden from this user but still visible to the other participant
   */
  async deleteMessageForMe(
    messageId: string,
    userId: number,
  ): Promise<{ deleted: boolean }> {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify user is sender or recipient
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw new ForbiddenException('You are not part of this conversation');
    }

    // Check if already deleted for this user
    if (message.deletedFor?.includes(userId)) {
      return { deleted: true };
    }

    // Add user to deletedFor array
    await this.messageModel.findByIdAndUpdate(messageId, {
      $addToSet: { deletedFor: userId },
    });

    return { deleted: true };
  }

  /**
   * Delete a message for everyone
   * Only the sender can delete for everyone
   * Shows "This message was deleted" to all participants
   */
  async deleteMessageForEveryone(
    messageId: string,
    userId: number,
  ): Promise<{ deleted: boolean; message: Message }> {
    const message = await this.messageModel.findById(messageId);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only sender can delete for everyone
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can delete for everyone');
    }

    // Check if already deleted for everyone
    if (message.isDeleted) {
      return { deleted: true, message };
    }

    // Mark as deleted for everyone
    const updatedMessage = await this.messageModel.findByIdAndUpdate(
      messageId,
      {
        isDeleted: true,
        deletedAt: new Date(),
        content: '', // Clear content for privacy
      },
      { new: true },
    );

    return { deleted: true, message: updatedMessage ?? message };
  }

  /**
   * Get a message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    return this.messageModel.findById(messageId);
  }

  /**
   * Get a conversation by ID
   */
  async getConversationById(
    conversationId: string,
  ): Promise<Conversation | null> {
    return this.conversationModel.findById(conversationId);
  }

  /**
   * Get users that current user can chat with
   * (Same department, excluding admins)
   */
  async getChatableUsers(userId: number): Promise<Users[]> {
    const currentUser = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role', 'department'],
    });

    if (!currentUser || !currentUser.department) {
      return [];
    }

    // Get users in same department, excluding current user
    const users = await this.usersRepository.find({
      where: {
        department: { id: currentUser.department.id },
        isActive: true,
      },
      relations: ['userRoles', 'userRoles.role', 'department'],
    });

    // Filter out admins and current user
    return users.filter((user) => {
      if (user.id === userId) return false;

      const roles =
        user.userRoles?.map((ur) => ur.role?.name?.toLowerCase()) || [];
      return !roles.includes('admin');
    });
  }

  // ==================== GROUP CHAT METHODS ====================

  /**
   * Create a new group chat
   * Any user can create a group with members from the same department
   */
  async createGroup(
    creatorId: number,
    dto: CreateGroupDto,
  ): Promise<Conversation> {
    // Get creator with department info
    const creator = await this.usersRepository.findOne({
      where: { id: creatorId },
      relations: ['department'],
    });

    if (!creator || !creator.department) {
      throw new BadRequestException('User must belong to a department');
    }

    // Verify all members belong to the same department
    const members = await this.usersRepository.find({
      where: { id: In(dto.memberIds) },
      relations: ['department'],
    });

    const invalidMembers = members.filter(
      (m) => m.department?.id !== creator.department?.id,
    );
    if (invalidMembers.length > 0) {
      throw new BadRequestException(
        'All members must belong to the same department',
      );
    }

    // Create participants array (creator + members, no duplicates)
    const participants = [
      creatorId,
      ...dto.memberIds.filter((id) => id !== creatorId),
    ];

    // Set join timestamp for all participants
    const now = new Date();
    const memberJoinedAt: Record<string, Date> = {};
    for (const participantId of participants) {
      memberJoinedAt[participantId.toString()] = now;
    }

    // Create the group conversation
    const group = await this.conversationModel.create({
      participants,
      isGroup: true,
      groupName: dto.name,
      groupAvatar: dto.avatar || null,
      groupAdmin: creatorId,
      companyId: creator.department.id, // Store department ID for validation
      lastMessage: null,
      lastMessageSenderId: null,
      lastMessageAt: new Date(),
      memberJoinedAt,
    });

    return group;
  }

  /**
   * Update group info (name, avatar)
   * Only the group admin can update
   */
  async updateGroup(
    groupId: string,
    userId: number,
    dto: UpdateGroupDto,
  ): Promise<Conversation> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (group.groupAdmin !== userId) {
      throw new ForbiddenException(
        'Only the group admin can update group info',
      );
    }

    const updateData: Partial<Conversation> = {};
    if (dto.name !== undefined) updateData.groupName = dto.name;
    if (dto.avatar !== undefined) updateData.groupAvatar = dto.avatar;

    const updated = await this.conversationModel.findByIdAndUpdate(
      groupId,
      updateData,
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Group not found');
    }
    return updated;
  }

  /**
   * Add members to a group
   * Only the group admin can add members
   */
  async addGroupMembers(
    groupId: string,
    userId: number,
    dto: AddGroupMembersDto,
  ): Promise<Conversation> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (group.groupAdmin !== userId) {
      throw new ForbiddenException('Only the group admin can add members');
    }

    // Verify new members belong to the same department
    const newMembers = await this.usersRepository.find({
      where: { id: In(dto.memberIds) },
      relations: ['department'],
    });

    const invalidMembers = newMembers.filter(
      (m) => m.department?.id !== group.companyId, // companyId stores departmentId
    );
    if (invalidMembers.length > 0) {
      throw new BadRequestException(
        'All members must belong to the same department',
      );
    }

    // Filter out members already in group
    const existingParticipants = new Set(group.participants);
    const newParticipantIds = dto.memberIds.filter(
      (id) => !existingParticipants.has(id),
    );

    if (newParticipantIds.length === 0) {
      return group;
    }

    // Set join timestamp for new members
    const now = new Date();
    const memberJoinedAtUpdates: Record<string, Date> = {};
    for (const memberId of newParticipantIds) {
      memberJoinedAtUpdates[`memberJoinedAt.${memberId}`] = now;
    }

    const updated = await this.conversationModel.findByIdAndUpdate(
      groupId,
      {
        $addToSet: { participants: { $each: newParticipantIds } },
        $set: memberJoinedAtUpdates,
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Group not found');
    }
    return updated;
  }

  /**
   * Remove a member from a group
   * Only the group admin can remove members
   */
  async removeGroupMember(
    groupId: string,
    adminId: number,
    memberId: number,
  ): Promise<Conversation> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (group.groupAdmin !== adminId) {
      throw new ForbiddenException('Only the group admin can remove members');
    }

    if (memberId === adminId) {
      throw new BadRequestException(
        'Admin cannot remove themselves. Transfer admin rights first or delete the group.',
      );
    }

    const updated = await this.conversationModel.findByIdAndUpdate(
      groupId,
      { $pull: { participants: memberId } },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Group not found');
    }
    return updated;
  }

  /**
   * Leave a group
   * Any member can leave. If admin leaves and there are other members,
   * they MUST specify who becomes the new admin (like WhatsApp).
   */
  async leaveGroup(
    groupId: string,
    userId: number,
    newAdminId?: number,
  ): Promise<{
    left: boolean;
    newAdminId?: number;
    remainingParticipants: number[];
    groupDeleted?: boolean;
  }> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (!group.participants.includes(userId)) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Remove user from participants
    const remainingParticipants = group.participants.filter(
      (p) => p !== userId,
    );

    // If no participants left, delete the group
    if (remainingParticipants.length === 0) {
      await this.conversationModel.findByIdAndDelete(groupId);
      return { left: true, remainingParticipants: [], groupDeleted: true };
    }

    // If admin is leaving, they MUST specify new admin (WhatsApp behavior)
    let newAdmin = group.groupAdmin;
    if (group.groupAdmin === userId) {
      if (!newAdminId) {
        throw new BadRequestException(
          'Admin must select a new admin before leaving the group',
        );
      }
      if (!remainingParticipants.includes(newAdminId)) {
        throw new BadRequestException(
          'Selected user is not a member of this group',
        );
      }
      newAdmin = newAdminId;
    }

    await this.conversationModel.findByIdAndUpdate(groupId, {
      participants: remainingParticipants,
      groupAdmin: newAdmin,
    });

    return {
      left: true,
      newAdminId: group.groupAdmin === userId ? newAdmin : undefined,
      remainingParticipants,
    };
  }

  /**
   * Delete a group entirely
   * Only the group admin can delete the group
   */
  async deleteGroup(
    groupId: string,
    userId: number,
  ): Promise<{ deleted: boolean; participantIds: number[] }> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (group.groupAdmin !== userId) {
      throw new ForbiddenException('Only the group admin can delete the group');
    }

    // Delete all messages in the group
    await this.messageModel.deleteMany({
      conversationId: group._id,
    });

    // Delete the group conversation
    await this.conversationModel.findByIdAndDelete(groupId);

    // Return all participant IDs so we can notify them
    return { deleted: true, participantIds: group.participants };
  }

  /**
   * Send a message to a group
   */
  async sendGroupMessage(
    senderId: number,
    groupId: string,
    content: string,
    attachment?: MessageAttachment | null,
    mentions?: MessageMention[],
    mentionsAll?: boolean,
  ): Promise<{ message: Message; conversation: Conversation }> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    if (!group.participants.includes(senderId)) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Create message with group-specific fields
    const message = await this.messageModel.create({
      conversationId: group._id,
      senderId,
      recipientId: null,
      content,
      status: MessageStatus.SENT,
      isGroupMessage: true,
      deliveredTo: [],
      readBy: [],
      attachment: attachment || null,
      mentions: mentions || [],
      mentionsAll: mentionsAll || false,
    });

    // Generate last message preview (WhatsApp-style attachment labels)
    let lastMessagePreview = content;
    if (attachment) {
      const attachmentLabels: Record<string, string> = {
        image: '📷 Photo',
        video: '🎥 Video',
        document: '📄 Document',
        voice: '🎤 Voice message',
      };
      const label = attachmentLabels[attachment.type] || '📎 Attachment';
      lastMessagePreview = content ? `${label}: ${content}` : label;
    } else if (content.length > 100) {
      lastMessagePreview = content.substring(0, 100) + '...';
    }

    // Update conversation with last message (reset system message metadata)
    await this.conversationModel.findByIdAndUpdate(group._id, {
      lastMessage: lastMessagePreview,
      lastMessageSenderId: senderId,
      lastMessageAt: new Date(),
      deletedFor: [],
      // Reset system message metadata since this is a regular message
      lastMessageSystemType: null,
      lastMessageTargetUserId: null,
      lastMessageActorUserId: null,
    });

    return { message, conversation: group };
  }

  /**
   * Mark a group message as delivered for a specific member
   */
  async markGroupMessageDelivered(
    messageId: string,
    userId: number,
  ): Promise<Message | null> {
    const message = await this.messageModel.findById(messageId);

    if (!message || !message.isGroupMessage) {
      return null;
    }

    // Don't mark if sender
    if (message.senderId === userId) {
      return message;
    }

    // Check if already delivered
    const alreadyDelivered = message.deliveredTo?.some(
      (d: MemberStatus) => d.userId === userId,
    );
    if (alreadyDelivered) {
      return message;
    }

    const updated = await this.messageModel.findByIdAndUpdate(
      messageId,
      {
        $push: {
          deliveredTo: { userId, timestamp: new Date() },
        },
      },
      { new: true },
    );

    return updated;
  }

  /**
   * Mark group messages as read for a member
   * Respects memberJoinedAt - only marks messages sent after user joined
   */
  async markGroupMessagesAsRead(
    groupId: string,
    userId: number,
  ): Promise<{ messageIds: string[]; senderIds: number[] }> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      return { messageIds: [], senderIds: [] };
    }

    if (!group.participants.includes(userId)) {
      return { messageIds: [], senderIds: [] };
    }

    // Build query filter
    const queryFilter: Record<string, unknown> = {
      conversationId: new Types.ObjectId(groupId),
      isGroupMessage: true,
      senderId: { $ne: userId },
      'readBy.userId': { $ne: userId },
    };

    // Only mark messages sent after user joined (WhatsApp behavior)
    const userJoinedAt = group.memberJoinedAt?.get(userId.toString());
    if (userJoinedAt) {
      queryFilter.createdAt = { $gte: userJoinedAt };
    }

    // Find messages not yet read by this user (excluding own messages)
    const unreadMessages = await this.messageModel.find(queryFilter);

    if (unreadMessages.length === 0) {
      return { messageIds: [], senderIds: [] };
    }

    const messageIds = unreadMessages.map((m) => m._id.toString());
    const senderIds = [...new Set(unreadMessages.map((m) => m.senderId))];

    // Update all messages to add this user to readBy
    await this.messageModel.updateMany(
      { _id: { $in: unreadMessages.map((m) => m._id) } },
      { $push: { readBy: { userId, timestamp: new Date() } } },
    );

    return { messageIds, senderIds };
  }

  /**
   * Get group message info (who delivered/read)
   * For the "Message Info" view like WhatsApp
   */
  async getGroupMessageInfo(
    messageId: string,
    userId: number,
  ): Promise<{
    deliveredTo: Array<{ userId: number; timestamp: Date }>;
    readBy: Array<{ userId: number; timestamp: Date }>;
    pending: number[];
  } | null> {
    const message = await this.messageModel.findById(messageId);

    if (!message || !message.isGroupMessage) {
      return null;
    }

    const group = await this.conversationModel.findById(message.conversationId);

    if (!group || !group.participants.includes(userId)) {
      return null;
    }

    // Only sender can view detailed info
    if (message.senderId !== userId) {
      throw new ForbiddenException('Only the sender can view message info');
    }

    // Calculate who hasn't received the message yet
    const deliveredUserIds = new Set(
      (message.deliveredTo || []).map((d: MemberStatus) => d.userId),
    );
    const readUserIds = new Set(
      (message.readBy || []).map((r: MemberStatus) => r.userId),
    );

    const pending = group.participants.filter(
      (p) =>
        p !== message.senderId &&
        !deliveredUserIds.has(p) &&
        !readUserIds.has(p),
    );

    return {
      deliveredTo: (message.deliveredTo || []).map((d: MemberStatus) => ({
        userId: d.userId,
        timestamp: d.timestamp,
      })),
      readBy: (message.readBy || []).map((r: MemberStatus) => ({
        userId: r.userId,
        timestamp: r.timestamp,
      })),
      pending,
    };
  }

  /**
   * Get all group conversations for a user
   */
  async getUserGroupConversations(userId: number): Promise<Conversation[]> {
    return this.conversationModel
      .find({
        participants: userId,
        isGroup: true,
        deletedFor: { $ne: userId },
      })
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  /**
   * Get pending group messages for delivery when user comes online
   * Respects memberJoinedAt - only delivers messages sent after user joined
   */
  async getPendingGroupMessagesForDelivery(userId: number): Promise<
    Array<{
      message: Message;
      conversation: Conversation;
      senderId: number;
    }>
  > {
    // Find all group conversations user is part of
    const groups = await this.conversationModel.find({
      participants: userId,
      isGroup: true,
    });

    if (groups.length === 0) {
      return [];
    }

    // Create group map for lookup and memberJoinedAt map
    const groupMap = new Map<string, Conversation>();
    const memberJoinedAtMap = new Map<string, Date | undefined>();
    for (const group of groups) {
      groupMap.set(group._id.toString(), group);
      memberJoinedAtMap.set(
        group._id.toString(),
        group.memberJoinedAt?.get(userId.toString()),
      );
    }

    const results: Array<{
      message: Message;
      conversation: Conversation;
      senderId: number;
    }> = [];

    // Find pending messages per group (with memberJoinedAt filter)
    for (const group of groups) {
      const joinedAt = memberJoinedAtMap.get(group._id.toString());

      const queryFilter: Record<string, unknown> = {
        conversationId: group._id,
        isGroupMessage: true,
        senderId: { $ne: userId },
        'deliveredTo.userId': { $ne: userId },
      };

      // Only deliver messages sent after user joined (WhatsApp behavior)
      if (joinedAt) {
        queryFilter.createdAt = { $gte: joinedAt };
      }

      const pendingMessages = await this.messageModel
        .find(queryFilter)
        .sort({ createdAt: 1 })
        .exec();

      for (const message of pendingMessages) {
        results.push({
          message,
          conversation: group,
          senderId: message.senderId,
        });
      }
    }

    // Sort all results by createdAt (from timestamps: true in schema)
    results.sort((a, b) => {
      const aTime = (a.message as unknown as { createdAt: Date }).createdAt;
      const bTime = (b.message as unknown as { createdAt: Date }).createdAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });

    return results;
  }

  /**
   * Get a group by ID
   */
  async getGroupById(groupId: string): Promise<Conversation | null> {
    const group = await this.conversationModel.findById(groupId);
    if (!group || !group.isGroup) {
      return null;
    }
    return group;
  }

  /**
   * Check if all members have read a group message
   * Used to determine if ticks should turn blue
   */
  async isGroupMessageFullyRead(messageId: string): Promise<boolean> {
    const message = await this.messageModel.findById(messageId);
    if (!message || !message.isGroupMessage) {
      return false;
    }

    const group = await this.conversationModel.findById(message.conversationId);
    if (!group) {
      return false;
    }

    // All participants except sender should have read
    const otherParticipants = group.participants.filter(
      (p) => p !== message.senderId,
    );
    const readUserIds = new Set(
      (message.readBy || []).map((r: MemberStatus) => r.userId),
    );

    return otherParticipants.every((p) => readUserIds.has(p));
  }

  // ==================== SYSTEM MESSAGE METHODS ====================

  /**
   * Create a system message in a group chat
   * Used for WhatsApp-style notifications (member joined/left/removed/admin changed)
   */
  async createSystemMessage(
    groupId: string,
    type: SystemMessageType,
    targetUserId: number,
    actorUserId?: number,
    content?: string,
  ): Promise<Message> {
    const group = await this.conversationModel.findById(groupId);

    if (!group || !group.isGroup) {
      throw new NotFoundException('Group not found');
    }

    // Create system message
    const message = await this.messageModel.create({
      conversationId: group._id,
      senderId: actorUserId || targetUserId, // System messages use actor or target as sender
      recipientId: null,
      content: content || '', // Content will be generated on frontend based on type
      status: MessageStatus.SENT,
      isGroupMessage: true,
      isSystemMessage: true,
      systemMessageType: type,
      targetUserId,
      actorUserId: actorUserId || null,
      deliveredTo: [],
      readBy: [],
    });

    // Update conversation's last message with system message metadata
    await this.conversationModel.findByIdAndUpdate(group._id, {
      lastMessage: content || 'System message',
      lastMessageSenderId: actorUserId || targetUserId,
      lastMessageAt: new Date(),
      lastMessageSystemType: type,
      lastMessageTargetUserId: targetUserId,
      lastMessageActorUserId: actorUserId || null,
    });

    return message;
  }

  /**
   * Get user info by ID (for system message display)
   */
  async getUserById(userId: number): Promise<Users | null> {
    return this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'firstname', 'lastname'],
    });
  }

  /**
   * Get multiple users by IDs (for system message display)
   */
  async getUsersByIds(userIds: number[]): Promise<Users[]> {
    return this.usersRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'firstname', 'lastname'],
    });
  }
}
