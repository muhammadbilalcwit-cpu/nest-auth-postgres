import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { ApiResponse } from '../common/utils/api-response';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { SystemMessageType } from './schemas/message.schema';
import { groupAvatarUploadOptions } from './group-avatar-upload.config';
import {
  chatAttachmentUploadOptions,
  voiceNoteUploadOptions,
  getAttachmentType,
  ATTACHMENT_SIZE_LIMITS,
} from './chat-attachment-upload.config';

/**
 * Chat Controller
 *
 * REST API endpoints for chat functionality:
 * - Get chatable users (same department)
 * - Get conversations list
 * - Get messages in a conversation
 * - Get unread count
 */
@Controller('chat')
@UseGuards(AuthGuard('jwt'))
@ApiTags('chat')
@ApiBearerAuth('JWT')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatGateway: ChatGateway,
  ) {}

  /**
   * Get users that current user can chat with
   */
  @Get('users')
  @ApiOperation({ summary: 'Get users available for chat (same department)' })
  async getChatableUsers(@Req() req: RequestWithUser) {
    const users = await this.chatService.getChatableUsers(req.user.id);

    // Add online status
    const usersWithStatus = users.map((user) => ({
      id: user.id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      profilePicture: user.profilePicture,
      isOnline: this.chatGateway.isUserOnline(user.id),
      roles: user.userRoles?.map((ur) => ur.role?.name) || [],
    }));

    return ApiResponse.success(
      'Chatable users retrieved successfully',
      200,
      usersWithStatus,
    );
  }

  /**
   * Get all conversations for current user
   * Includes otherUser data for each conversation
   */
  @Get('conversations')
  @ApiOperation({ summary: 'Get all conversations' })
  async getConversations(@Req() req: RequestWithUser) {
    const [conversations, chatableUsers, unreadCounts] = await Promise.all([
      this.chatService.getUserConversations(req.user.id),
      this.chatService.getChatableUsers(req.user.id),
      this.chatService.getUnreadCountsByConversation(req.user.id),
    ]);

    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    // Enrich conversations with otherUser data and unread counts
    const enrichedConversations = conversations.map((conv) => {
      // Find the other participant (not the current user)
      const otherUserId = conv.participants.find((id) => id !== req.user.id);
      const otherUser = otherUserId ? userMap.get(otherUserId) : null;
      const convObj = conv.toObject() as Record<string, unknown>;
      const convId = (conv._id as { toString(): string }).toString();

      return {
        ...convObj,
        otherUser: otherUser
          ? {
              id: otherUser.id,
              firstname: otherUser.firstname,
              lastname: otherUser.lastname,
              email: otherUser.email,
              profilePicture: otherUser.profilePicture,
              isOnline: this.chatGateway.isUserOnline(otherUser.id),
            }
          : null,
        unreadCount: unreadCounts.get(convId) || 0,
      };
    });

    return ApiResponse.success(
      'Conversations retrieved successfully',
      200,
      enrichedConversations,
    );
  }

  /**
   * Get messages in a conversation
   */
  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get messages in a conversation' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getMessages(
    @Req() req: RequestWithUser,
    @Param('id') conversationId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.chatService.getConversationMessages(
      conversationId,
      req.user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );

    return ApiResponse.success('Messages retrieved successfully', 200, result);
  }

  /**
   * Get or create a conversation with another user
   * Includes otherUser data in response
   */
  @Post('conversations/:userId')
  @ApiOperation({ summary: 'Get or create conversation with a user' })
  async getOrCreateConversation(
    @Req() req: RequestWithUser,
    @Param('userId') otherUserId: string,
  ) {
    const otherUserIdNum = parseInt(otherUserId, 10);
    const conversation = await this.chatService.getOrCreateConversation(
      req.user.id,
      otherUserIdNum,
    );

    // Get other user info
    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const otherUser = chatableUsers.find((u) => u.id === otherUserIdNum);
    const convObj = conversation.toObject() as Record<string, unknown>;

    const enrichedConversation = {
      ...convObj,
      otherUser: otherUser
        ? {
            id: otherUser.id,
            firstname: otherUser.firstname,
            lastname: otherUser.lastname,
            email: otherUser.email,
            profilePicture: otherUser.profilePicture,
            isOnline: this.chatGateway.isUserOnline(otherUser.id),
          }
        : null,
      unreadCount: 0,
    };

    return ApiResponse.success(
      'Conversation retrieved successfully',
      200,
      enrichedConversation,
    );
  }

  /**
   * Mark all messages in a conversation as read
   */
  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Mark conversation messages as read' })
  async markAsRead(
    @Req() req: RequestWithUser,
    @Param('id') conversationId: string,
  ) {
    const count = await this.chatService.markAsRead(
      conversationId,
      req.user.id,
    );

    return ApiResponse.success('Messages marked as read', 200, {
      markedCount: count,
    });
  }

  /**
   * Get unread message count (includes both 1:1 and group messages)
   */
  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread message count (1:1 + groups)' })
  async getUnreadCount(@Req() req: RequestWithUser) {
    const counts = await this.chatService.getTotalUnreadCount(req.user.id);

    return ApiResponse.success('Unread count retrieved', 200, {
      count: counts.total,
      direct: counts.direct,
      groups: counts.groups,
    });
  }

  // ==================== ATTACHMENT ENDPOINTS ====================

  /**
   * Upload a chat attachment (image, video, document)
   * Returns attachment metadata for use in message
   */
  @Post('attachments')
  @ApiOperation({ summary: 'Upload a chat attachment' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', chatAttachmentUploadOptions))
  uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const attachmentType = getAttachmentType(file.mimetype);
    if (!attachmentType) {
      throw new BadRequestException('Invalid file type');
    }

    // Validate size limits per type
    const sizeLimit = ATTACHMENT_SIZE_LIMITS[attachmentType];
    if (file.size > sizeLimit) {
      throw new BadRequestException(
        `File too large. Maximum size for ${attachmentType} is ${sizeLimit / (1024 * 1024)}MB`,
      );
    }

    const url = `/uploads/chat-attachments/${file.filename}`;

    return ApiResponse.success('Attachment uploaded successfully', 200, {
      type: attachmentType,
      url,
      filename: file.filename,
      originalFilename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    });
  }

  /**
   * Upload a voice note
   * Separate endpoint with smaller size limit
   */
  @Post('attachments/voice')
  @ApiOperation({ summary: 'Upload a voice note' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds',
        },
        waveform: {
          type: 'string',
          description: 'JSON array of waveform data points',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', voiceNoteUploadOptions))
  uploadVoiceNote(
    @UploadedFile() file: Express.Multer.File,
    @Body('duration') duration?: string,
    @Body('waveform') waveform?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const url = `/uploads/chat-attachments/${file.filename}`;

    // Parse waveform if provided
    let waveformData: number[] | undefined;
    if (waveform) {
      try {
        waveformData = JSON.parse(waveform) as number[];
      } catch {
        // Ignore parse errors, waveform is optional
      }
    }

    return ApiResponse.success('Voice note uploaded successfully', 200, {
      type: 'voice' as const,
      url,
      filename: file.filename,
      originalFilename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      duration: duration ? parseFloat(duration) : undefined,
      waveform: waveformData,
    });
  }

  /**
   * Delete a message
   * - forEveryone=false: Delete for current user only (message hidden from you)
   * - forEveryone=true: Delete for everyone (shows "This message was deleted")
   * Only sender can delete for everyone
   */
  @Delete('messages/:id')
  @ApiOperation({ summary: 'Delete a message' })
  @ApiQuery({ name: 'forEveryone', required: false, type: Boolean })
  async deleteMessage(
    @Req() req: RequestWithUser,
    @Param('id') messageId: string,
    @Query('forEveryone') forEveryone?: string,
  ) {
    const deleteForEveryone = forEveryone === 'true';

    if (deleteForEveryone) {
      const result = await this.chatService.deleteMessageForEveryone(
        messageId,
        req.user.id,
      );

      // Notify via WebSocket that message was deleted for everyone
      const message = result.message;

      if (message.isGroupMessage) {
        // For group messages, get participants and emit to all
        const conversation = await this.chatService.getConversationById(
          message.conversationId.toString(),
        );
        if (conversation) {
          this.chatGateway.emitGroupMessageDeleted(
            conversation.participants,
            req.user.id,
            messageId,
            message.conversationId.toString(),
          );
        }
      } else {
        // For 1:1 messages, emit to recipient only
        this.chatGateway.emitMessageDeleted(
          message.recipientId,
          messageId,
          message.conversationId.toString(),
        );
      }

      return ApiResponse.success('Message deleted for everyone', 200, {
        deleted: true,
        forEveryone: true,
      });
    } else {
      await this.chatService.deleteMessageForMe(messageId, req.user.id);

      return ApiResponse.success('Message deleted for you', 200, {
        deleted: true,
        forEveryone: false,
      });
    }
  }

  /**
   * Soft delete a conversation for the current user
   * The conversation will be hidden from this user but still visible to the other participant
   * If a new message is sent, the conversation will be restored automatically
   */
  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation (soft delete)' })
  async deleteConversation(
    @Req() req: RequestWithUser,
    @Param('id') conversationId: string,
  ) {
    const result = await this.chatService.deleteConversation(
      conversationId,
      req.user.id,
    );

    return ApiResponse.success(
      'Conversation deleted successfully',
      200,
      result,
    );
  }

  // ==================== GROUP ENDPOINTS ====================

  /**
   * Create a new group chat
   * Any user can create a group with members from same department
   */
  @Post('groups')
  @ApiOperation({ summary: 'Create a new group chat' })
  async createGroup(@Req() req: RequestWithUser, @Body() dto: CreateGroupDto) {
    const group = await this.chatService.createGroup(req.user.id, dto);

    // Get member info for response
    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    const members = group.participants.map((id) => {
      const user = userMap.get(id);
      return user
        ? {
            id: user.id,
            firstname: user.firstname,
            lastname: user.lastname,
            profilePicture: user.profilePicture,
            isOnline: this.chatGateway.isUserOnline(user.id),
          }
        : { id, firstname: 'Unknown', lastname: '', isOnline: false };
    });

    const groupId = (group._id as { toString(): string }).toString();

    // Create "group created" system message (WhatsApp-style)
    const creatorUser = await this.chatService.getUserById(req.user.id);
    const creatorName = creatorUser
      ? `${creatorUser.firstname} ${creatorUser.lastname}`.trim()
      : 'Unknown';

    const systemMessage = await this.chatService.createSystemMessage(
      groupId,
      SystemMessageType.GROUP_CREATED,
      req.user.id, // targetUserId is the creator
      req.user.id, // actorUserId is also the creator
      `${creatorName} created this group`,
    );

    // Fetch the updated group with system message metadata
    const updatedGroup = await this.chatService.getGroupById(groupId);
    const groupObj = (updatedGroup || group).toObject() as Record<
      string,
      unknown
    >;

    // Full group data to send to members (WhatsApp-style instant notification)
    const fullGroupData = {
      ...groupObj,
      members,
    };

    // Notify all members (except creator) via socket with full group data
    // So they see the group appear instantly like WhatsApp
    for (const memberId of group.participants) {
      if (memberId !== req.user.id) {
        this.chatGateway.emitGroupMemberAdded(memberId, groupId, fullGroupData);
      }
    }

    // Emit the system message to all group members for real-time display
    this.chatGateway.emitSystemMessage(group.participants, groupId, {
      ...systemMessage.toObject(),
      conversationId: groupId,
    });

    // Mark system message as delivered for all online participants (except sender)
    // This prevents it from being re-delivered when users reconnect
    const systemMessageId = (
      systemMessage._id as { toString(): string }
    ).toString();
    for (const participantId of group.participants) {
      if (
        participantId !== req.user.id &&
        this.chatGateway.isUserOnline(participantId)
      ) {
        await this.chatService.markGroupMessageDelivered(
          systemMessageId,
          participantId,
        );
      }
    }

    return ApiResponse.success(
      'Group created successfully',
      201,
      fullGroupData,
    );
  }

  /**
   * Get all groups for current user
   */
  @Get('groups')
  @ApiOperation({ summary: 'Get all group conversations' })
  async getGroups(@Req() req: RequestWithUser) {
    const groups = await this.chatService.getUserGroupConversations(
      req.user.id,
    );
    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    // Get unread counts for all groups
    const groupIds = groups.map((g) =>
      (g._id as { toString(): string }).toString(),
    );
    const unreadCounts = await this.chatService.getGroupUnreadCounts(
      groupIds,
      req.user.id,
    );

    const enrichedGroups = groups.map((group) => {
      const members = group.participants.map((id) => {
        const user = userMap.get(id);
        return user
          ? {
              id: user.id,
              firstname: user.firstname,
              lastname: user.lastname,
              profilePicture: user.profilePicture,
              isOnline: this.chatGateway.isUserOnline(user.id),
            }
          : { id, firstname: 'Unknown', lastname: '', isOnline: false };
      });

      const groupObj = group.toObject() as Record<string, unknown>;
      const groupId = group._id.toString();

      return {
        ...groupObj,
        members,
        unreadCount: unreadCounts.get(groupId) || 0,
      };
    });

    return ApiResponse.success(
      'Groups retrieved successfully',
      200,
      enrichedGroups,
    );
  }

  /**
   * Get group details by ID
   */
  @Get('groups/:id')
  @ApiOperation({ summary: 'Get group details' })
  async getGroup(@Req() req: RequestWithUser, @Param('id') groupId: string) {
    const group = await this.chatService.getGroupById(groupId);

    if (!group) {
      return ApiResponse.error('Group not found', 404);
    }

    if (!group.participants.includes(req.user.id)) {
      return ApiResponse.error('You are not a member of this group', 403);
    }

    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    const members = group.participants.map((id) => {
      const user = userMap.get(id);
      return user
        ? {
            id: user.id,
            firstname: user.firstname,
            lastname: user.lastname,
            profilePicture: user.profilePicture,
            isOnline: this.chatGateway.isUserOnline(user.id),
          }
        : { id, firstname: 'Unknown', lastname: '', isOnline: false };
    });

    const groupObj = group.toObject() as Record<string, unknown>;

    return ApiResponse.success('Group retrieved successfully', 200, {
      ...groupObj,
      members,
    });
  }

  /**
   * Update group info (name, avatar)
   * Only group admin can update
   */
  @Patch('groups/:id')
  @ApiOperation({ summary: 'Update group info' })
  async updateGroup(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    const group = await this.chatService.updateGroup(groupId, req.user.id, dto);
    const groupObj = group.toObject() as Record<string, unknown>;

    return ApiResponse.success('Group updated successfully', 200, groupObj);
  }

  /**
   * Upload group avatar (admin only)
   */
  @Post('groups/:id/avatar')
  @ApiOperation({ summary: 'Upload group avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('avatar', groupAvatarUploadOptions))
  async uploadGroupAvatar(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Update group with new avatar URL
    const avatarUrl = `/uploads/group-avatars/${file.filename}`;
    const group = await this.chatService.updateGroup(groupId, req.user.id, {
      avatar: avatarUrl,
    });

    const groupObj = group.toObject() as Record<string, unknown>;

    return ApiResponse.success('Group avatar uploaded successfully', 200, {
      avatarUrl,
      group: groupObj,
    });
  }

  /**
   * Add members to a group
   * Only group admin can add members
   */
  @Post('groups/:id/members')
  @ApiOperation({ summary: 'Add members to group' })
  async addGroupMembers(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @Body() dto: AddGroupMembersDto,
  ) {
    const group = await this.chatService.addGroupMembers(
      groupId,
      req.user.id,
      dto,
    );

    // Get member info for the updated group
    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    const members = group.participants.map((id) => {
      const user = userMap.get(id);
      return user
        ? {
            id: user.id,
            firstname: user.firstname,
            lastname: user.lastname,
            profilePicture: user.profilePicture,
            isOnline: this.chatGateway.isUserOnline(user.id),
          }
        : { id, firstname: 'Unknown', lastname: '', isOnline: false };
    });

    const groupObj = group.toObject() as Record<string, unknown>;
    const fullGroupData = { ...groupObj, members };

    // Filter only the members that were actually added (not already in group)
    const actuallyAddedMembers = dto.memberIds.filter((id) =>
      group.participants.includes(id),
    );

    // Notify new members via WebSocket with full group data
    for (const memberId of actuallyAddedMembers) {
      this.chatGateway.emitGroupMemberAdded(memberId, groupId, fullGroupData);
    }

    // Notify existing members about the new additions (real-time member count update)
    this.chatGateway.emitGroupMembersAdded(
      group.participants,
      groupId,
      actuallyAddedMembers,
      fullGroupData,
    );

    // Create system messages for each added member (WhatsApp-style)
    const adminUser = await this.chatService.getUserById(req.user.id);
    const addedUsers =
      await this.chatService.getUsersByIds(actuallyAddedMembers);
    const addedUserMap = new Map(addedUsers.map((u) => [u.id, u]));

    for (const memberId of actuallyAddedMembers) {
      const addedUser = addedUserMap.get(memberId);
      const addedUserName = addedUser
        ? `${addedUser.firstname} ${addedUser.lastname}`.trim()
        : 'Unknown';
      const adminName = adminUser
        ? `${adminUser.firstname} ${adminUser.lastname}`.trim()
        : 'Admin';

      const systemMessage = await this.chatService.createSystemMessage(
        groupId,
        SystemMessageType.MEMBER_ADDED,
        memberId,
        req.user.id,
        `${adminName} added ${addedUserName}`,
      );

      // Emit the system message to all group members for real-time display
      this.chatGateway.emitSystemMessage(group.participants, groupId, {
        ...systemMessage.toObject(),
        conversationId: groupId,
      });

      // Mark system message as delivered for online participants (except sender)
      const sysMessageId = (
        systemMessage._id as { toString(): string }
      ).toString();
      for (const participantId of group.participants) {
        if (
          participantId !== req.user.id &&
          this.chatGateway.isUserOnline(participantId)
        ) {
          await this.chatService.markGroupMessageDelivered(
            sysMessageId,
            participantId,
          );
        }
      }
    }

    return ApiResponse.success(
      'Members added successfully',
      200,
      fullGroupData,
    );
  }

  /**
   * Remove a member from group
   * Only group admin can remove members
   */
  @Delete('groups/:id/members/:memberId')
  @ApiOperation({ summary: 'Remove member from group' })
  async removeGroupMember(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @Param('memberId') memberId: string,
  ) {
    const memberIdNum = parseInt(memberId, 10);

    // Get user info before removal for system message
    const [adminUser, removedUser] = await Promise.all([
      this.chatService.getUserById(req.user.id),
      this.chatService.getUserById(memberIdNum),
    ]);

    const group = await this.chatService.removeGroupMember(
      groupId,
      req.user.id,
      memberIdNum,
    );

    // Create system message: "Admin removed John" (WhatsApp-style)
    const adminName = adminUser
      ? `${adminUser.firstname} ${adminUser.lastname}`.trim()
      : 'Admin';
    const removedUserName = removedUser
      ? `${removedUser.firstname} ${removedUser.lastname}`.trim()
      : 'Unknown';

    const systemMessage = await this.chatService.createSystemMessage(
      groupId,
      SystemMessageType.MEMBER_REMOVED,
      memberIdNum,
      req.user.id,
      `${adminName} removed ${removedUserName}`,
    );

    // Emit system message to remaining members
    this.chatGateway.emitSystemMessage(group.participants, groupId, {
      ...systemMessage.toObject(),
      conversationId: groupId,
    });

    // Mark system message as delivered for online participants (except sender)
    const sysMessageId = (
      systemMessage._id as { toString(): string }
    ).toString();
    for (const participantId of group.participants) {
      if (
        participantId !== req.user.id &&
        this.chatGateway.isUserOnline(participantId)
      ) {
        await this.chatService.markGroupMessageDelivered(
          sysMessageId,
          participantId,
        );
      }
    }

    // Notify removed member via WebSocket (they remove group from list)
    this.chatGateway.emitGroupMemberRemoved(memberIdNum, groupId);

    // Notify remaining members about the removal (real-time member count update)
    this.chatGateway.emitGroupMemberLeft(
      group.participants,
      groupId,
      memberIdNum,
    );

    const groupObj = group.toObject() as Record<string, unknown>;

    return ApiResponse.success('Member removed successfully', 200, groupObj);
  }

  /**
   * Leave a group
   * Any member can leave. If admin leaves, they MUST specify new admin (WhatsApp behavior).
   */
  @Post('groups/:id/leave')
  @ApiOperation({ summary: 'Leave a group' })
  async leaveGroup(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @Body() body?: { newAdminId?: number },
  ) {
    // Get user info before leaving for system message
    const leavingUser = await this.chatService.getUserById(req.user.id);

    const result = await this.chatService.leaveGroup(
      groupId,
      req.user.id,
      body?.newAdminId,
    );

    // Notify the user that they left (they remove group from their list)
    this.chatGateway.emitGroupMemberRemoved(req.user.id, groupId);

    // Notify all remaining members so they can update member count in real-time
    // (WhatsApp behavior - members see count decrease instantly)
    if (!result.groupDeleted && result.remainingParticipants.length > 0) {
      // Create system message: "John left" (WhatsApp-style)
      const leavingUserName = leavingUser
        ? `${leavingUser.firstname} ${leavingUser.lastname}`.trim()
        : 'Unknown';

      const systemMessage = await this.chatService.createSystemMessage(
        groupId,
        SystemMessageType.MEMBER_LEFT,
        req.user.id,
        undefined, // No actor - user left voluntarily
        `${leavingUserName} left`,
      );

      // Emit system message to remaining members
      this.chatGateway.emitSystemMessage(
        result.remainingParticipants,
        groupId,
        {
          ...systemMessage.toObject(),
          conversationId: groupId,
        },
      );

      // Mark system message as delivered for online participants
      const sysMessageId = (
        systemMessage._id as { toString(): string }
      ).toString();
      for (const participantId of result.remainingParticipants) {
        if (this.chatGateway.isUserOnline(participantId)) {
          await this.chatService.markGroupMessageDelivered(
            sysMessageId,
            participantId,
          );
        }
      }

      // If admin changed, also create a system message for that
      if (result.newAdminId) {
        const newAdminUser = await this.chatService.getUserById(
          result.newAdminId,
        );
        const newAdminName = newAdminUser
          ? `${newAdminUser.firstname} ${newAdminUser.lastname}`.trim()
          : 'Unknown';

        const adminChangedMessage = await this.chatService.createSystemMessage(
          groupId,
          SystemMessageType.ADMIN_CHANGED,
          result.newAdminId,
          req.user.id,
          `${newAdminName} is now the admin`,
        );

        // Emit admin changed system message
        this.chatGateway.emitSystemMessage(
          result.remainingParticipants,
          groupId,
          {
            ...adminChangedMessage.toObject(),
            conversationId: groupId,
          },
        );

        // Mark admin changed message as delivered for online participants
        const adminMsgId = (
          adminChangedMessage._id as { toString(): string }
        ).toString();
        for (const participantId of result.remainingParticipants) {
          if (this.chatGateway.isUserOnline(participantId)) {
            await this.chatService.markGroupMessageDelivered(
              adminMsgId,
              participantId,
            );
          }
        }
      }

      this.chatGateway.emitGroupMemberLeft(
        result.remainingParticipants,
        groupId,
        req.user.id,
        result.newAdminId,
      );
    }

    return ApiResponse.success('Left group successfully', 200, {
      left: result.left,
      newAdminId: result.newAdminId,
    });
  }

  /**
   * Delete a group entirely (Admin only)
   * Removes all messages and the group
   */
  @Delete('groups/:id')
  @ApiOperation({ summary: 'Delete a group (admin only)' })
  async deleteGroup(@Req() req: RequestWithUser, @Param('id') groupId: string) {
    const result = await this.chatService.deleteGroup(groupId, req.user.id);

    // Notify all participants that the group was deleted
    for (const participantId of result.participantIds) {
      if (participantId !== req.user.id) {
        this.chatGateway.emitGroupMemberRemoved(participantId, groupId);
      }
    }

    return ApiResponse.success('Group deleted successfully', 200, {
      deleted: result.deleted,
    });
  }

  /**
   * Get messages in a group
   */
  @Get('groups/:id/messages')
  @ApiOperation({ summary: 'Get group messages' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getGroupMessages(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.chatService.getConversationMessages(
      groupId,
      req.user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );

    return ApiResponse.success(
      'Group messages retrieved successfully',
      200,
      result,
    );
  }

  /**
   * Get message info (delivery/read status for group messages)
   * Only sender can view this
   */
  @Get('messages/:id/info')
  @ApiOperation({ summary: 'Get message delivery/read info (groups only)' })
  async getMessageInfo(
    @Req() req: RequestWithUser,
    @Param('id') messageId: string,
  ) {
    const info = await this.chatService.getGroupMessageInfo(
      messageId,
      req.user.id,
    );

    if (!info) {
      return ApiResponse.error('Message not found or not a group message', 404);
    }

    // Get user details for the response
    const chatableUsers = await this.chatService.getChatableUsers(req.user.id);
    const userMap = new Map(chatableUsers.map((u) => [u.id, u]));

    const enrichedInfo = {
      deliveredTo: info.deliveredTo.map((d) => {
        const user = userMap.get(d.userId);
        return {
          userId: d.userId,
          timestamp: d.timestamp,
          user: user
            ? {
                firstname: user.firstname,
                lastname: user.lastname,
                profilePicture: user.profilePicture,
              }
            : null,
        };
      }),
      readBy: info.readBy.map((r) => {
        const user = userMap.get(r.userId);
        return {
          userId: r.userId,
          timestamp: r.timestamp,
          user: user
            ? {
                firstname: user.firstname,
                lastname: user.lastname,
                profilePicture: user.profilePicture,
              }
            : null,
        };
      }),
      pending: info.pending.map((id) => {
        const user = userMap.get(id);
        return {
          userId: id,
          user: user
            ? {
                firstname: user.firstname,
                lastname: user.lastname,
                profilePicture: user.profilePicture,
              }
            : null,
        };
      }),
    };

    return ApiResponse.success(
      'Message info retrieved successfully',
      200,
      enrichedInfo,
    );
  }

  /**
   * Mark group messages as read
   */
  @Post('groups/:id/read')
  @ApiOperation({ summary: 'Mark group messages as read' })
  async markGroupAsRead(
    @Req() req: RequestWithUser,
    @Param('id') groupId: string,
  ) {
    const result = await this.chatService.markGroupMessagesAsRead(
      groupId,
      req.user.id,
    );

    // Notify senders about read status
    for (const senderId of result.senderIds) {
      this.chatGateway.emitGroupMessagesRead(
        senderId,
        groupId,
        req.user.id,
        result.messageIds,
      );
    }

    return ApiResponse.success('Messages marked as read', 200, {
      markedCount: result.messageIds.length,
    });
  }
}
