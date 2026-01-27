export interface NotificationPayload {
  id: number;
  type: string;
  title: string;
  message: string;
  data?: unknown;
  actorId: number | null;
  actorEmail: string | null;
  createdAt: Date;
  isRead: boolean;
}

export interface NotificationResponse {
  id: number;
  type: string;
  title: string;
  message: string;
  data: object | null;
  actorId: number | null;
  actorEmail: string | null;
  createdAt: Date;
  isRead: boolean;
  readAt: Date | null;
}
