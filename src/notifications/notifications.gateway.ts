import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departments } from '../entities/entities/Departments';
import * as cookie from 'cookie';

export interface NotificationPayload {
  type: string;
  message: string;
  data?: any;
  performedBy: {
    id: number;
    email: string;
  };
  timestamp: string;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Map to track which company each socket belongs to
  private socketCompanyMap: Map<string, number> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(Departments)
    private readonly departmentsRepo: Repository<Departments>,
  ) {}

  afterInit() {
    console.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      // Extract JWT from cookies
      const cookies = client.handshake.headers.cookie;
      if (!cookies) {
        console.log(`WebSocket: No cookies found, disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      const parsedCookies = cookie.parse(cookies);
      const token = parsedCookies.accessToken;

      if (!token) {
        console.log(
          `WebSocket: No accessToken in cookies, disconnecting ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = this.jwtService.verify(token, {
        secret: 'KJdkfjkdfjkj_dsofkdf_@#@!@#@!@#@!@#',
      });

      if (!payload || !payload.sub) {
        console.log(`WebSocket: Invalid token, disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      // Option C: Get company directly from JWT payload (single source of truth)
      const jwtPayload = payload as {
        sub: number;
        email: string;
        companyId?: number;
        departmentId?: number;
        roles: string[];
      };
      let companyId: number | null = jwtPayload.companyId || null;

      // Fallback: Get company from department if companyId not in payload
      if (!companyId && jwtPayload.departmentId) {
        const dept = await this.departmentsRepo.findOne({
          where: { id: jwtPayload.departmentId },
          relations: ['company'],
        });
        companyId = dept?.company?.id || null;
      }

      if (!companyId) {
        console.log(
          `WebSocket: User ${jwtPayload.sub} has no company, disconnecting ${client.id}`,
        );
        client.disconnect();
        return;
      }

      // Store mapping and join company room
      this.socketCompanyMap.set(client.id, companyId);
      const roomName = `company:${companyId}`;
      client.join(roomName);

      console.log(
        `WebSocket: User ${jwtPayload.sub} (${jwtPayload.email}) connected to room ${roomName}`,
      );
    } catch (error) {
      console.log(
        `WebSocket: Authentication failed for ${client.id}:`,
        error.message,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const companyId = this.socketCompanyMap.get(client.id);
    this.socketCompanyMap.delete(client.id);
    console.log(
      `WebSocket: Client ${client.id} disconnected from company:${companyId}`,
    );
  }

  /**
   * Emit notification to all users in a specific company
   */
  emitToCompany(companyId: number, notification: NotificationPayload) {
    const roomName = `company:${companyId}`;
    this.server.to(roomName).emit('notification', notification);
    console.log(
      `WebSocket: Emitted "${notification.type}" to room ${roomName}`,
    );
  }

  /**
   * Get connected clients count for a company
   */
  async getCompanyClientsCount(companyId: number): Promise<number> {
    const roomName = `company:${companyId}`;
    const sockets = await this.server.in(roomName).fetchSockets();
    return sockets.length;
  }
}
