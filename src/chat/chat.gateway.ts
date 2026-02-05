import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Inject, forwardRef, UsePipes, ValidationPipe } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AttachmentType, MessageMention } from './schemas/message.schema';

/** Attachment data structure for messages */
interface MessageAttachmentData {
  type: AttachmentType;
  url: string;
  thumbnailUrl?: string;
  filename: string;
  originalFilename: string;
  size: number;
  mimeType: string;
  duration?: number;
  waveform?: number[];
  width?: number;
  height?: number;
}

/** Validated message payload interface for type narrowing */
interface ValidatedSendMessage {
  tempId: string;
  recipientId: number;
  content: string;
  attachment?: MessageAttachmentData;
  mentions?: MessageMention[];
}

/**
 * Type guard to validate attachment structure
 */
function isValidAttachment(data: unknown): data is MessageAttachmentData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    Object.values(AttachmentType).includes(obj.type as AttachmentType) &&
    typeof obj.url === 'string' &&
    typeof obj.filename === 'string' &&
    typeof obj.originalFilename === 'string' &&
    typeof obj.size === 'number' &&
    typeof obj.mimeType === 'string'
  );
}

/**
 * Type guard to validate mention structure
 */
function isValidMention(data: unknown): data is MessageMention {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.userId === 'number' &&
    typeof obj.displayName === 'string' &&
    typeof obj.position === 'number' &&
    typeof obj.length === 'number'
  );
}

/**
 * Type guard to validate SendMessageDto structure
 * Used to satisfy strict ESLint type checking after ValidationPipe
 */
function isValidSendMessage(data: unknown): data is ValidatedSendMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  const hasValidBase =
    typeof obj.tempId === 'string' &&
    typeof obj.recipientId === 'number' &&
    typeof obj.content === 'string';

  if (!hasValidBase) return false;

  // Attachment is optional, but if present must be valid
  if (obj.attachment !== undefined && !isValidAttachment(obj.attachment)) {
    return false;
  }

  // Mentions is optional, but if present must be a valid array
  if (obj.mentions !== undefined) {
    if (!Array.isArray(obj.mentions)) return false;
    if (!obj.mentions.every(isValidMention)) return false;
  }

  return true;
}

/**
 * Chat Gateway
 *
 * Handles real-time WebSocket communication for chat.
 * Uses the same connection as NotificationsGateway (no namespace).
 * User tracking and connection management is handled by NotificationsGateway.
 *
 * Events (Client → Server):
 * - chat:send - Send a new message (with tempId for optimistic updates)
 * - chat:typing - User is typing
 * - chat:read - Mark messages as read
 *
 * Events (Server → Client):
 * - chat:receive - New message received
 * - chat:typing - Someone is typing
 * - chat:message_confirmed - Message saved, maps tempId → realId
 * - chat:status_updated - Message status changed (delivered/read)
 * - chat:message_deleted - Message deleted for everyone
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway {
  constructor(
    private chatService: ChatService,
    private rabbitmqService: RabbitmqService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Called after gateway is initialized
   * Register the WebSocket callbacks with RabbitMQ service
   */
  afterInit(): void {
    // Register callback for RabbitMQ to deliver messages via WebSocket
    this.rabbitmqService.setDeliveryCallback((recipientId, data) => {
      const socketIds = this.notificationsGateway.getUserSocketIds(recipientId);
      if (socketIds.length > 0) {
        // Emit to all user's sockets (multiple tabs)
        for (const socketId of socketIds) {
          this.notificationsGateway.server
            .to(socketId)
            .emit('chat:receive', data);
        }
        console.log(
          `Chat Gateway: Message delivered to user ${recipientId} via WebSocket (${socketIds.length} socket(s))`,
        );
      }
    });

    // Register callback for status updates (delivered/read notifications to sender)
    this.rabbitmqService.setStatusUpdateCallback((senderId, data) => {
      this.emitStatusUpdate(senderId, data);
    });

    // Register callback for message confirmation (tempId → realId mapping)
    this.rabbitmqService.setMessageConfirmCallback((senderId, data) => {
      this.emitMessageConfirmed(senderId, data);
    });

    // Register callback to deliver pending messages when user comes online
    this.notificationsGateway.setUserConnectedCallback((userId: number) =>
      this.deliverPendingMessages(userId),
    );

    console.log('Chat Gateway initialized');
  }

  /**
   * Handle sending a new message
   *
   * Enterprise Pattern: Queue-First for Reliability
   * 1. Queue message to RabbitMQ (guaranteed not to be lost)
   * 2. RabbitMQ consumer saves to MongoDB and emits confirmation
   * 3. Frontend receives chat:message_confirmed with tempId → realId mapping
   */
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage('chat:send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawDto: unknown,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Type guard validates structure (ValidationPipe validates at runtime)
      if (!isValidSendMessage(rawDto)) {
        return { success: false, error: 'Invalid message format' };
      }

      // Destructure after type guard narrows type to ValidatedSendMessage
      const { tempId, recipientId, content, attachment, mentions } = rawDto;

      const userInfo = this.getUserInfo(client.id);
      if (!userInfo) {
        return { success: false, error: 'Not authenticated' };
      }

      const { userId: senderId, companyId } = userInfo;

      // Queue message to RabbitMQ (consumer will save and confirm)
      const published = await this.rabbitmqService.publishMessage(
        tempId,
        senderId,
        recipientId,
        content,
        companyId,
        attachment,
        mentions,
      );

      if (!published) {
        return { success: false, error: 'Failed to queue message' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error sending message:', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to send message',
      };
    }
  }

  /**
   * Handle typing indicator
   */
  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { recipientId: number; isTyping: boolean },
  ): void {
    const userInfo = this.getUserInfo(client.id);
    if (!userInfo) return;

    const recipientSocketIds = this.notificationsGateway.getUserSocketIds(
      data.recipientId,
    );
    for (const socketId of recipientSocketIds) {
      // Send { senderId, isTyping } to match frontend expectations
      this.notificationsGateway.server.to(socketId).emit('chat:typing', {
        senderId: userInfo.userId,
        isTyping: data.isTyping,
      });
    }
  }

  /**
   * Handle marking messages as read
   * Also notifies senders that their messages were read
   */
  @SubscribeMessage('chat:read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<{ success: boolean }> {
    try {
      const userInfo = this.getUserInfo(client.id);
      if (!userInfo) {
        return { success: false };
      }

      // Mark messages as read and get the affected message IDs and senders
      const result = await this.chatService.markAsReadAndGetSenders(
        data.conversationId,
        userInfo.userId,
      );

      // Notify each sender that their messages were read
      for (const senderId of result.senderIds) {
        this.emitStatusUpdate(senderId, {
          conversationId: data.conversationId,
          status: 'read',
          messageIds: result.messageIds,
          readBy: userInfo.userId,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking as read:', error);
      return { success: false };
    }
  }

  // ==================== GROUP MESSAGE HANDLERS ====================

  /**
   * Handle sending a group message
   */
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage('chat:group_send')
  async handleSendGroupMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawDto: unknown,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate structure
      if (!this.isValidGroupMessage(rawDto)) {
        return { success: false, error: 'Invalid group message format' };
      }

      const { tempId, groupId, content, attachment, mentions, mentionsAll } =
        rawDto;

      const userInfo = this.getUserInfo(client.id);
      if (!userInfo) {
        return { success: false, error: 'Not authenticated' };
      }

      const { userId: senderId } = userInfo;

      // Send group message via service (cast attachment type for compatibility)
      const { message, conversation } = await this.chatService.sendGroupMessage(
        senderId,
        groupId,
        content,
        attachment as Parameters<typeof this.chatService.sendGroupMessage>[3],
        mentions,
        mentionsAll,
      );

      const messageId = (
        message as unknown as { _id: { toString(): string } }
      )._id.toString();
      const conversationId = (
        conversation as unknown as { _id: { toString(): string } }
      )._id.toString();

      // Confirm to sender with tempId → realId mapping
      this.emitMessageConfirmed(senderId, {
        tempId,
        messageId,
        conversationId,
      });

      // Emit to all group members (except sender)
      this.emitGroupMessage(conversation.participants, senderId, {
        message,
        conversation,
      });

      // Mark as delivered for online members and notify sender
      for (const participantId of conversation.participants) {
        if (participantId === senderId) continue;

        if (this.isUserOnline(participantId)) {
          // Mark delivered for this user
          await this.chatService.markGroupMessageDelivered(
            messageId,
            participantId,
          );

          // Notify sender
          this.emitGroupMessageDelivered(
            senderId,
            groupId,
            messageId,
            participantId,
          );
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error sending group message:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to send group message',
      };
    }
  }

  /**
   * Handle group typing indicator
   */
  @SubscribeMessage('chat:group_typing')
  handleGroupTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; isTyping: boolean },
  ): void {
    const userInfo = this.getUserInfo(client.id);
    if (!userInfo) return;

    // Get group to find all participants
    void this.chatService.getGroupById(data.groupId).then((group) => {
      if (!group) return;

      // Notify all group members except sender
      for (const participantId of group.participants) {
        if (participantId === userInfo.userId) continue;

        const socketIds =
          this.notificationsGateway.getUserSocketIds(participantId);
        for (const socketId of socketIds) {
          this.notificationsGateway.server
            .to(socketId)
            .emit('chat:group_typing', {
              groupId: data.groupId,
              senderId: userInfo.userId,
              isTyping: data.isTyping,
            });
        }
      }
    });
  }

  /**
   * Handle marking group messages as read
   */
  @SubscribeMessage('chat:group_read')
  async handleGroupMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string },
  ): Promise<{ success: boolean }> {
    try {
      const userInfo = this.getUserInfo(client.id);
      if (!userInfo) {
        return { success: false };
      }

      const result = await this.chatService.markGroupMessagesAsRead(
        data.groupId,
        userInfo.userId,
      );

      // Notify senders that their messages were read
      for (const senderId of result.senderIds) {
        this.emitGroupMessagesRead(
          senderId,
          data.groupId,
          userInfo.userId,
          result.messageIds,
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking group messages as read:', error);
      return { success: false };
    }
  }

  /**
   * Type guard for group message validation
   */
  private isValidGroupMessage(data: unknown): data is {
    tempId: string;
    groupId: string;
    content: string;
    attachment?: MessageAttachmentData;
    mentions?: MessageMention[];
    mentionsAll?: boolean;
  } {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    const obj = data as Record<string, unknown>;
    const hasValidBase =
      typeof obj.tempId === 'string' &&
      typeof obj.groupId === 'string' &&
      typeof obj.content === 'string';

    if (!hasValidBase) return false;

    // Attachment is optional, but if present must be valid
    if (obj.attachment !== undefined && !isValidAttachment(obj.attachment)) {
      return false;
    }

    // Mentions is optional, but if present must be a valid array
    if (obj.mentions !== undefined) {
      if (!Array.isArray(obj.mentions)) return false;
      if (!obj.mentions.every(isValidMention)) return false;
    }

    // mentionsAll is optional boolean
    if (obj.mentionsAll !== undefined && typeof obj.mentionsAll !== 'boolean') {
      return false;
    }

    return true;
  }

  /**
   * Check if a user is currently online
   */
  isUserOnline(userId: number): boolean {
    return this.notificationsGateway.isUserConnected(userId);
  }

  /**
   * Get list of online users from a list of user IDs
   */
  getOnlineUsers(userIds: number[]): number[] {
    return userIds.filter((id) =>
      this.notificationsGateway.isUserConnected(id),
    );
  }

  /**
   * Deliver pending messages to a user who just came online
   * Called by NotificationsGateway when user connects for the first time
   * Handles both 1:1 and group messages
   */
  async deliverPendingMessages(userId: number): Promise<void> {
    try {
      const socketIds = this.notificationsGateway.getUserSocketIds(userId);
      if (socketIds.length === 0) {
        return;
      }

      // Deliver pending 1:1 messages
      await this.deliverPendingDirectMessages(userId);

      // Deliver pending group messages
      await this.deliverPendingGroupMessages(userId);
    } catch (error) {
      console.error(
        `Chat Gateway: Error delivering pending messages to user ${userId}:`,
        error,
      );
    }
  }

  /**
   * Deliver pending 1:1 messages when user comes online
   *
   * WhatsApp Enterprise Pattern:
   * - Only marks messages as "delivered" in database (updates status)
   * - Does NOT emit chat:receive events (would cause double-counting)
   * - User sees messages when they open the conversation (via API)
   * - Unread count comes from server API, not socket events
   * - Senders are notified that messages were delivered (double ticks)
   */
  private async deliverPendingDirectMessages(userId: number): Promise<void> {
    const pendingItems =
      await this.chatService.getPendingMessagesForDelivery(userId);

    if (pendingItems.length === 0) {
      return;
    }

    console.log(
      `Chat Gateway: Marking ${pendingItems.length} pending direct message(s) as delivered for user ${userId}`,
    );

    // Group messages by sender for status updates
    const messagesBySender = new Map<
      number,
      Array<{ messageId: string; conversationId: string }>
    >();

    // Track messages (NO socket emit to avoid double-counting)
    for (const item of pendingItems) {
      const messageId = (
        item.message as unknown as { _id: { toString(): string } }
      )._id.toString();
      const conversationId = (
        item.conversation as unknown as { _id: { toString(): string } }
      )._id.toString();

      // Track for sender notification
      const senderMessages = messagesBySender.get(item.senderId) || [];
      senderMessages.push({ messageId, conversationId });
      messagesBySender.set(item.senderId, senderMessages);
    }

    // Mark all messages as delivered in database (WhatsApp pattern: silent delivery)
    const messageIds = pendingItems.map((item) =>
      (
        item.message as unknown as { _id: { toString(): string } }
      )._id.toString(),
    );
    await this.chatService.markAsDelivered(messageIds, userId);

    // Notify each sender that their messages were delivered (they see double ticks)
    for (const [senderId, messages] of messagesBySender) {
      // Group by conversation for cleaner status updates
      const byConversation = new Map<string, string[]>();
      for (const msg of messages) {
        const ids = byConversation.get(msg.conversationId) || [];
        ids.push(msg.messageId);
        byConversation.set(msg.conversationId, ids);
      }

      for (const [conversationId, msgIds] of byConversation) {
        this.emitStatusUpdate(senderId, {
          conversationId,
          status: 'delivered',
          messageIds: msgIds,
        });
      }
    }

    console.log(
      `Chat Gateway: Successfully marked ${pendingItems.length} pending direct message(s) as delivered for user ${userId}`,
    );
  }

  /**
   * Deliver pending group messages when user comes online
   *
   * WhatsApp Enterprise Pattern:
   * - Only marks messages as "delivered" in database (updates deliveredTo array)
   * - Does NOT emit chat:group_message events (would cause double-counting)
   * - User sees messages when they open the group (via fetchGroupMessages API)
   * - Unread count comes from server API (getGroupUnreadCounts), not socket events
   * - Senders are notified that messages were delivered (double blue ticks)
   */
  private async deliverPendingGroupMessages(userId: number): Promise<void> {
    const pendingItems =
      await this.chatService.getPendingGroupMessagesForDelivery(userId);

    if (pendingItems.length === 0) {
      return;
    }

    console.log(
      `Chat Gateway: Marking ${pendingItems.length} pending group message(s) as delivered for user ${userId}`,
    );

    // Group messages by sender and group for status updates
    const messagesBySenderAndGroup = new Map<number, Map<string, string[]>>();

    // Mark each message as delivered (NO socket emit to avoid double-counting)
    for (const item of pendingItems) {
      const messageId = (
        item.message as unknown as { _id: { toString(): string } }
      )._id.toString();
      const groupId = (
        item.conversation as unknown as { _id: { toString(): string } }
      )._id.toString();

      // Mark as delivered in database (WhatsApp pattern: silent delivery)
      await this.chatService.markGroupMessageDelivered(messageId, userId);

      // Track for sender notification (senders should see double blue ticks)
      if (!messagesBySenderAndGroup.has(item.senderId)) {
        messagesBySenderAndGroup.set(item.senderId, new Map());
      }
      const groupMap = messagesBySenderAndGroup.get(item.senderId);
      if (groupMap && !groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      const messageList = groupMap?.get(groupId);
      if (messageList) {
        messageList.push(messageId);
      }
    }

    // Notify senders about delivery (they see double ticks)
    for (const [senderId, groupMap] of messagesBySenderAndGroup) {
      for (const [groupId, messageIds] of groupMap) {
        for (const messageId of messageIds) {
          this.emitGroupMessageDelivered(senderId, groupId, messageId, userId);
        }
      }
    }

    console.log(
      `Chat Gateway: Successfully marked ${pendingItems.length} pending group message(s) as delivered for user ${userId}`,
    );
  }

  /**
   * Emit message confirmation to sender
   * Maps tempId to real MongoDB ID after message is saved
   */
  emitMessageConfirmed(
    senderId: number,
    data: {
      tempId: string;
      messageId: string;
      conversationId: string;
    },
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(senderId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:message_confirmed', data);
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: Message confirmed ${data.tempId} → ${data.messageId} to user ${senderId}`,
      );
    }
  }

  /**
   * Emit message status update to a user
   * Used to notify sender when their messages are delivered/read
   */
  emitStatusUpdate(
    userId: number,
    data: {
      conversationId: string;
      status: 'delivered' | 'read';
      messageIds: string[];
      readBy?: number;
    },
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(userId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:status_updated', data);
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: Status update (${data.status}) sent to user ${userId} for ${data.messageIds.length} message(s)`,
      );
    }
  }

  /**
   * Emit message deleted event to recipient
   * Used when sender deletes message for everyone
   */
  emitMessageDeleted(
    recipientId: number,
    messageId: string,
    conversationId: string,
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(recipientId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:message_deleted', {
          messageId,
          conversationId,
        });
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: Message deleted event sent to user ${recipientId}`,
      );
    }
  }

  /**
   * Get user info from socket ID using NotificationsGateway's maps
   * Helper method to access user context from socket
   */
  private getUserInfo(
    socketId: string,
  ): { userId: number; companyId: number } | null {
    // Access internal maps through a method we'll add to NotificationsGateway
    return this.notificationsGateway.getSocketUserInfo(socketId);
  }

  // ==================== GROUP EMIT METHODS ====================

  /**
   * Emit event when user is added to a group
   * Sends full group data so frontend can display immediately
   */
  emitGroupMemberAdded(
    userId: number,
    groupId: string,
    groupData?: unknown,
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(userId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:group_member_added', { groupId, group: groupData });
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: User ${userId} notified of being added to group ${groupId}`,
      );
    }
  }

  /**
   * Emit event when a member leaves or is removed from a group
   * Notifies all remaining members so they can update member count in real-time
   */
  emitGroupMemberLeft(
    participants: number[],
    groupId: string,
    leftUserId: number,
    newAdminId?: number,
  ): void {
    for (const participantId of participants) {
      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_member_left', {
            groupId,
            leftUserId,
            newAdminId,
          });
      }
    }
    console.log(
      `Chat Gateway: All members notified that user ${leftUserId} left group ${groupId}`,
    );
  }

  /**
   * Emit event when group info is updated (name, avatar)
   * Notifies all group members
   */
  emitGroupUpdated(participants: number[], groupData: unknown): void {
    for (const participantId of participants) {
      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_updated', { group: groupData });
      }
    }
  }

  /**
   * Emit event when members are added to a group
   * Notifies existing members about new additions
   */
  emitGroupMembersAdded(
    participants: number[],
    groupId: string,
    newMemberIds: number[],
    updatedGroup: unknown,
  ): void {
    for (const participantId of participants) {
      // Don't notify the new members through this event (they get group_member_added)
      if (newMemberIds.includes(participantId)) continue;

      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_members_added', {
            groupId,
            newMemberIds,
            group: updatedGroup,
          });
      }
    }
  }

  /**
   * Emit event when user is removed from a group
   */
  emitGroupMemberRemoved(userId: number, groupId: string): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(userId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:group_member_removed', { groupId });
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: User ${userId} notified of being removed from group ${groupId}`,
      );
    }
  }

  /**
   * Emit group message deleted event to all group members except the deleter
   * Used when sender deletes message for everyone in a group
   */
  emitGroupMessageDeleted(
    participants: number[],
    deleterId: number,
    messageId: string,
    groupId: string,
  ): void {
    for (const participantId of participants) {
      // Don't notify the person who deleted the message
      if (participantId === deleterId) continue;

      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_message_deleted', {
            messageId,
            groupId,
          });
      }
    }
    console.log(
      `Chat Gateway: Group message deleted event sent to ${participants.length - 1} members in group ${groupId}`,
    );
  }

  /**
   * Emit group messages read status to sender
   */
  emitGroupMessagesRead(
    senderId: number,
    groupId: string,
    readByUserId: number,
    messageIds: string[],
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(senderId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:group_messages_read', {
          groupId,
          readByUserId,
          messageIds,
        });
    }
    if (socketIds.length > 0) {
      console.log(
        `Chat Gateway: Sender ${senderId} notified of ${messageIds.length} messages read by user ${readByUserId} in group ${groupId}`,
      );
    }
  }

  /**
   * Emit new group message to all group members except sender
   */
  emitGroupMessage(
    participants: number[],
    senderId: number,
    data: { message: unknown; conversation: unknown },
  ): void {
    for (const participantId of participants) {
      if (participantId === senderId) continue;

      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_message', data);
      }
    }
  }

  /**
   * Emit group message delivered status to sender
   */
  emitGroupMessageDelivered(
    senderId: number,
    groupId: string,
    messageId: string,
    deliveredToUserId: number,
  ): void {
    const socketIds = this.notificationsGateway.getUserSocketIds(senderId);
    for (const socketId of socketIds) {
      this.notificationsGateway.server
        .to(socketId)
        .emit('chat:group_message_delivered', {
          groupId,
          messageId,
          deliveredToUserId,
        });
    }
  }

  /**
   * Emit a system message to all group participants
   * Used for WhatsApp-style notifications (member added/removed/left)
   */
  emitSystemMessage(
    participants: number[],
    groupId: string,
    systemMessage: unknown,
  ): void {
    for (const participantId of participants) {
      const socketIds =
        this.notificationsGateway.getUserSocketIds(participantId);
      for (const socketId of socketIds) {
        this.notificationsGateway.server
          .to(socketId)
          .emit('chat:group_system_message', {
            groupId,
            message: systemMessage,
          });
      }
    }
  }
}
