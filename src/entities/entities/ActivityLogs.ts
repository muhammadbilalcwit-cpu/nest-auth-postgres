import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('activity_logs_pkey', ['id'], { unique: true })
@Entity('activity_logs', { schema: 'public' })
export class ActivityLogs {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('integer', { name: 'userId', nullable: true })
  userId: number | null;

  @Column('character varying', { name: 'username', nullable: true })
  username: string | null;

  @Column('character varying', { name: 'ipAddress' })
  ipAddress: string;

  @Column('character varying', { name: 'api' })
  api: string;

  @Column('character varying', { name: 'method' })
  method: string;

  @Column('character varying', { name: 'reason' })
  reason: string;

  @Column('timestamp with time zone', {
    name: 'createdAt',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date | null;

  @Column('integer', { name: 'company_id', nullable: true })
  companyId: number | null;
}
