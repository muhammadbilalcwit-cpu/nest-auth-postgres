import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Users } from './Users';

@Index('sessions_pkey', ['id'], { unique: true })
@Index('idx_sessions_is_valid', ['isValid'], {})
@Index('idx_sessions_login_at', ['loginAt'], {})
@Index('idx_sessions_user_id', ['userId'], {})
@Entity('sessions', { schema: 'public' })
export class Sessions {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('integer', { name: 'user_id' })
  userId: number;

  @Column('character varying', { name: 'refresh_token_hash', length: 255 })
  refreshTokenHash: string;

  @Column('timestamp without time zone', {
    name: 'login_at',
    default: () => 'now()',
  })
  loginAt: Date;

  @Column('timestamp without time zone', {
    name: 'last_activity_at',
    default: () => 'now()',
  })
  lastActivityAt: Date;

  @Column('boolean', { name: 'is_valid', default: () => 'true' })
  isValid: boolean;

  @Column('character varying', {
    name: 'ip_address',
    nullable: true,
    length: 45,
  })
  ipAddress: string | null;

  @Column('text', { name: 'user_agent', nullable: true })
  userAgent: string | null;

  @Column('timestamp without time zone', {
    name: 'created_at',
    nullable: true,
    default: () => 'now()',
  })
  createdAt: Date | null;

  @Column('timestamp without time zone', {
    name: 'updated_at',
    nullable: true,
    default: () => 'now()',
  })
  updatedAt: Date | null;

  @ManyToOne(() => Users, (users) => users.sessions, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'user_id', referencedColumnName: 'id' }])
  user: Users;
}
