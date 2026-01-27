export interface CreateNotificationDto {
  companyId: number;
  type: string;
  title: string;
  message: string;
  data?: object;
  actorId?: number;
  actorEmail?: string;
}
