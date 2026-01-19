import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Departments } from './Departments';
import { Users } from './Users';

@Index('companies_pkey', ['id'], { unique: true })
@Entity('companies', { schema: 'public' })
export class Companies {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('character varying', { name: 'name', length: 255 })
  name: string;

  @Column('text', { name: 'address' })
  address: string;

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

  @OneToMany(() => Departments, (departments) => departments.company)
  departments: Departments[];

  @OneToMany(() => Users, (users) => users.company)
  users: Users[];
}
