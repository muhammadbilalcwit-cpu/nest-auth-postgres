import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Companies } from './Companies';
import { Users } from './Users';
import { UserNotifications } from './UserNotifications';

@Index('notifications_pkey', ['id'], { unique: true })
@Index('notifications_company_created', ['companyId', 'createdAt'])
@Entity('notifications', { schema: 'public' })
export class Notifications {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('integer', { name: 'company_id' })
  companyId: number;

  @Column('character varying', { name: 'type', length: 50 })
  type: string;

  @Column('character varying', { name: 'title', length: 255 })
  title: string;

  @Column('text', { name: 'message' })
  message: string;

  @Column('jsonb', { name: 'data', nullable: true })
  data: object | null;

  @Column('integer', { name: 'actor_id', nullable: true })
  actorId: number | null;

  @Column('character varying', { name: 'actor_email', length: 255, nullable: true })
  actorEmail: string | null;

  @Column('timestamp without time zone', {
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @ManyToOne(() => Companies, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'company_id', referencedColumnName: 'id' }])
  company: Companies;

  @ManyToOne(() => Users, { onDelete: 'SET NULL' })
  @JoinColumn([{ name: 'actor_id', referencedColumnName: 'id' }])
  actor: Users;

  @OneToMany(() => UserNotifications, (userNotification) => userNotification.notification)
  userNotifications: UserNotifications[];
}
