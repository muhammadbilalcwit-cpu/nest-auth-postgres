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

@Index('departments_pkey', ['id'], { unique: true })
@Entity('departments', { schema: 'public' })
export class Departments {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('character varying', { name: 'name', length: 255 })
  name: string;

  @Column('timestamp without time zone', {
    name: 'created_at',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date | null;

  @Column('timestamp without time zone', {
    name: 'updated_at',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date | null;

  @Column('boolean', {
    name: 'is_deleted',
    nullable: true,
    default: () => 'false',
  })
  isDeleted: boolean | null;

  @Column('timestamp without time zone', { name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => Companies, (companies) => companies.departments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([{ name: 'company_id', referencedColumnName: 'id' }])
  company: Companies;

  @OneToMany(() => Users, (users) => users.department)
  users: Users[];
}
