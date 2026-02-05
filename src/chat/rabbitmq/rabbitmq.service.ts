import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Redis } from 'ioredis';
import { ChatService } from '../chat.service';
import { AttachmentType, MessageMention } from '../schemas/message.schema';

/**
 * Attachment data structure for messages
 */
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

/**
 * Message payload structure for RabbitMQ
 * Includes tempId for frontend optimistic update reconciliation
 */
interface ChatMessagePayload {
  tempId: string;
  senderId: number;
  recipientId: number;
  content: string;
  senderCompanyId: number;
  attachment?: MessageAttachmentData;
  mentions?: MessageMention[];
}

/**
 * Callback type for delivering messages via WebSocket
 */
type MessageDeliveryCallback = (
  recipientId: number,
  data: { message: unknown; conversation: unknown },
) => void;

/**
 * Callback type for notifying sender of status update
 */
type StatusUpdateCallback = (
  senderId: number,
  data: {
    conversationId: string;
    status: 'delivered' | 'read';
    messageIds: string[];
  },
) => void;

/**
 * Callback type for confirming message save to sender
 * Maps tempId to real MongoDB ID
 */
type MessageConfirmCallback = (
  senderId: number,
  data: {
    tempId: string;
    messageId: string;
    conversationId: string;
  },
) => void;

/**
 * RabbitMQ Service
 *
 * Enterprise Pattern: Queue-First for Reliability
 * - Messages are queued first (guaranteed not to be lost)
 * - Consumer saves to MongoDB with retry logic
 * - DLQ for failed messages (can be recovered)
 * - Confirmation event maps tempId → realId for status tracking
 */
@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  private readonly queueName = 'chat.messages';
  private readonly dlqName = 'chat.messages.dlq';
  private readonly dlxName = 'chat.dlx';
  private readonly maxRetries = 3;
  private readonly reconnectDelay = 5000;

  private deliveryCallback: MessageDeliveryCallback | null = null;
  private statusUpdateCallback: StatusUpdateCallback | null = null;
  private messageConfirmCallback: MessageConfirmCallback | null = null;

  constructor(
    private configService: ConfigService,
    @Inject('REDIS_CLIENT')
    private redisClient: Redis,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.shouldReconnect = false;
    await this.disconnect();
  }

  /**
   * Set the callback for delivering messages via WebSocket
   */
  setDeliveryCallback(callback: MessageDeliveryCallback): void {
    this.deliveryCallback = callback;
    console.log('RabbitMQ: Message delivery callback registered');
  }

  /**
   * Set the callback for notifying sender of status updates
   */
  setStatusUpdateCallback(callback: StatusUpdateCallback): void {
    this.statusUpdateCallback = callback;
    console.log('RabbitMQ: Status update callback registered');
  }

  /**
   * Set the callback for confirming message save to sender
   * This maps tempId to real MongoDB ID
   */
  setMessageConfirmCallback(callback: MessageConfirmCallback): void {
    this.messageConfirmCallback = callback;
    console.log('RabbitMQ: Message confirm callback registered');
  }

  /**
   * Health check - returns connection status
   */
  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  /**
   * Get health status details
   */
  getHealthStatus(): { connected: boolean; queue: string; dlq: string } {
    return {
      connected: this.isConnected(),
      queue: this.queueName,
      dlq: this.dlqName,
    };
  }

  /**
   * Connect to RabbitMQ with auto-reconnect
   */
  private async connect(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const url = this.configService.get<string>('RABBITMQ_URL');
      if (!url) {
        console.warn('RABBITMQ_URL not configured, chat queuing disabled');
        this.isConnecting = false;
        return;
      }

      const conn = await amqp.connect(url);
      this.connection = conn;

      // Register error handler EARLY to catch channel errors
      conn.on('error', (err: Error) => {
        if (err.message.includes('PRECONDITION_FAILED')) {
          console.error(
            `\n` +
              `══════════════════════════════════════════════════════════════\n` +
              `RabbitMQ ERROR: Queue "${this.queueName}" exists with different config.\n` +
              `\n` +
              `Please delete the queue manually:\n` +
              `  1. Open RabbitMQ Management UI: http://localhost:15672\n` +
              `  2. Go to Queues tab\n` +
              `  3. Delete queue "${this.queueName}"\n` +
              `  4. Restart the application\n` +
              `══════════════════════════════════════════════════════════════\n`,
          );
          this.shouldReconnect = false;
        } else {
          console.error('RabbitMQ connection error:', err.message);
        }
      });

      this.channel = await conn.createConfirmChannel();

      // Setup Dead Letter Exchange
      await this.channel.assertExchange(this.dlxName, 'direct', {
        durable: true,
      });

      // Setup Dead Letter Queue
      await this.channel.assertQueue(this.dlqName, {
        durable: true,
      });
      await this.channel.bindQueue(this.dlqName, this.dlxName, this.queueName);

      // Setup main queue with DLX
      await this.channel.assertQueue(this.queueName, {
        durable: true,
        deadLetterExchange: this.dlxName,
        deadLetterRoutingKey: this.queueName,
      });

      // Start consumer
      await this.startConsumer();

      console.log('RabbitMQ connected successfully with DLQ');

      // Handle connection close - auto-reconnect
      conn.on('close', () => {
        console.log('RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;

        if (this.shouldReconnect) {
          console.log(
            `RabbitMQ: Reconnecting in ${this.reconnectDelay / 1000}s...`,
          );
          setTimeout(() => {
            void this.connect();
          }, this.reconnectDelay);
        }
      });

      this.isConnecting = false;
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      this.isConnecting = false;

      // Retry connection
      if (this.shouldReconnect) {
        console.log(
          `RabbitMQ: Retrying connection in ${this.reconnectDelay / 1000}s...`,
        );
        setTimeout(() => {
          void this.connect();
        }, this.reconnectDelay);
      }
    }
  }

  /**
   * Disconnect from RabbitMQ
   */
  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
    } catch (error) {
      console.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  /**
   * Start the message consumer with prefetch
   */
  private async startConsumer(): Promise<void> {
    if (!this.channel) {
      console.warn('RabbitMQ channel not available for consumer');
      return;
    }

    await this.channel.prefetch(10);

    await this.channel.consume(
      this.queueName,
      (msg) => {
        if (!msg) return;
        void this.processMessage(msg);
      },
      { noAck: false },
    );

    console.log('RabbitMQ: Message consumer started');
  }

  /**
   * Process a message with retry logic
   * Saves to MongoDB, delivers to recipient, and confirms to sender
   */
  private async processMessage(msg: ConsumeMessage): Promise<void> {
    const retryCount = this.getRetryCount(msg);

    try {
      const payload = JSON.parse(msg.content.toString()) as ChatMessagePayload;

      console.log(
        `RabbitMQ: Processing message from ${payload.senderId} to ` +
          `${payload.recipientId} (attempt ${retryCount + 1}/${this.maxRetries})`,
      );

      // Step 1: Save to MongoDB
      const { message, conversation } = await this.chatService.sendMessage(
        payload.senderId,
        {
          recipientId: payload.recipientId,
          content: payload.content,
          attachment: payload.attachment,
          mentions: payload.mentions,
        },
      );

      const messageId = (
        message as { _id: { toString(): string } }
      )._id.toString();
      const conversationId = (
        conversation as { _id: { toString(): string } }
      )._id.toString();

      // Step 2: Confirm to sender (map tempId → realId)
      if (this.messageConfirmCallback) {
        this.messageConfirmCallback(payload.senderId, {
          tempId: payload.tempId,
          messageId,
          conversationId,
        });
        console.log(
          `RabbitMQ: Confirmed message ${payload.tempId} → ${messageId} to sender`,
        );
      }

      // Step 3: Deliver to recipient if online
      const isRecipientOnline = await this.isUserOnline(
        payload.recipientId,
        payload.senderCompanyId,
      );

      if (isRecipientOnline && this.deliveryCallback) {
        const messageData = { message, conversation };
        console.log(
          `RabbitMQ: User ${payload.recipientId} is online, delivering via WebSocket`,
        );
        this.deliveryCallback(payload.recipientId, messageData);

        // Mark message as delivered
        await this.chatService.markAsDelivered(
          [messageId],
          payload.recipientId,
        );

        // Notify sender that message was delivered
        if (this.statusUpdateCallback) {
          this.statusUpdateCallback(payload.senderId, {
            conversationId,
            status: 'delivered',
            messageIds: [messageId],
          });
        }
      } else {
        console.log(
          `RabbitMQ: User ${payload.recipientId} is offline, message saved to MongoDB`,
        );
      }

      // Success - acknowledge
      this.channel?.ack(msg);
    } catch (error) {
      console.error(
        `RabbitMQ: Error processing message (attempt ${retryCount + 1}):`,
        error,
      );

      if (retryCount < this.maxRetries - 1) {
        // Retry: republish with incremented retry count
        console.log(
          `RabbitMQ: Retrying message (${retryCount + 2}/${this.maxRetries})`,
        );
        this.republishWithRetry(msg, retryCount + 1);
        this.channel?.ack(msg);
      } else {
        // Max retries reached - send to DLQ
        console.error(
          `RabbitMQ: Max retries (${this.maxRetries}) reached, sending to DLQ`,
        );
        this.channel?.nack(msg, false, false);
      }
    }
  }

  /**
   * Get retry count from message headers
   */
  private getRetryCount(msg: ConsumeMessage): number {
    const headers = msg.properties.headers || {};
    return (headers['x-retry-count'] as number) || 0;
  }

  /**
   * Republish message with incremented retry count
   */
  private republishWithRetry(msg: ConsumeMessage, retryCount: number): void {
    if (!this.channel) return;

    const headers = {
      ...(msg.properties.headers || {}),
      'x-retry-count': retryCount,
    };

    this.channel.sendToQueue(this.queueName, msg.content, {
      persistent: true,
      contentType: 'application/json',
      headers,
    });
  }

  /**
   * Check if user is online in Redis
   * Uses the same key as NotificationsGateway: online:company:{companyId}
   */
  private async isUserOnline(
    userId: number,
    companyId: number,
  ): Promise<boolean> {
    const key = `online:company:${companyId}`;
    const result = await this.redisClient.sismember(key, userId.toString());
    return result === 1;
  }

  /**
   * Publish a message with guaranteed delivery
   * Now includes tempId for optimistic update reconciliation
   * Supports optional attachment for media messages
   * Supports optional mentions for @mentions
   */
  async publishMessage(
    tempId: string,
    senderId: number,
    recipientId: number,
    content: string,
    senderCompanyId: number,
    attachment?: MessageAttachmentData,
    mentions?: MessageMention[],
  ): Promise<boolean> {
    if (!this.channel) {
      console.warn('RabbitMQ channel not available');
      return false;
    }

    const payload: ChatMessagePayload = {
      tempId,
      senderId,
      recipientId,
      content,
      senderCompanyId,
      attachment,
      mentions,
    };

    try {
      this.channel.sendToQueue(
        this.queueName,
        Buffer.from(JSON.stringify(payload)),
        {
          persistent: true,
          contentType: 'application/json',
          headers: { 'x-retry-count': 0 },
        },
      );

      await this.channel.waitForConfirms();

      console.log(
        `RabbitMQ: Message ${tempId} published from ${senderId} to ${recipientId}`,
      );
      return true;
    } catch (error) {
      console.error('RabbitMQ: Failed to publish message:', error);
      return false;
    }
  }
}
