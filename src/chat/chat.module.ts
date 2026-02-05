import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { Users } from '../entities/entities/Users';
import { NotificationsModule } from '../notifications/notifications.module';
import { RedisModule } from '../redis/redis.module';

/**
 * Chat Module
 *
 * Provides internal chat functionality:
 * - MongoDB for message storage (Mongoose)
 * - RabbitMQ for message queuing
 * - WebSocket for real-time communication
 * - PostgreSQL for user data (TypeORM)
 *
 * Access Control:
 * - Managers can chat with anyone in their department
 * - Users can chat with other users + manager in their department
 * - Admins do not have access to chat
 */
@Module({
  imports: [
    // Reuse JwtModule from NotificationsModule for WebSocket auth
    NotificationsModule,
    // Redis for online status tracking
    RedisModule,
    // MongoDB schemas for chat
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    // PostgreSQL entity for user lookup
    TypeOrmModule.forFeature([Users]),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, RabbitmqService],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
