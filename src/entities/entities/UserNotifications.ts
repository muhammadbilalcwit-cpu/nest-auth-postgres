import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Users } from './Users';
import { Notifications } from './Notifications';

@Index('user_notifications_pkey', ['id'], { unique: true })
@Index('user_notifications_user_read', ['userId', 'isRead'])
@Index('user_notifications_user_notification', ['userId', 'notificationId'], { unique: true })
@Unique(['userId', 'notificationId'])
@Entity('user_notifications', { schema: 'public' })
export class UserNotifications {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('integer', { name: 'user_id' })
  userId: number;

  @Column('integer', { name: 'notification_id' })
  notificationId: number;

  @Column('boolean', { name: 'is_read', default: false })
  isRead: boolean;

  @Column('timestamp without time zone', { name: 'read_at', nullable: true })
  readAt: Date | null;

  @Column('timestamp without time zone', {
    name: 'delivered_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  deliveredAt: Date;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'user_id', referencedColumnName: 'id' }])
  user: Users;

  @ManyToOne(() => Notifications, (notification) => notification.userNotifications, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'notification_id', referencedColumnName: 'id' }])
  notification: Notifications;
}
