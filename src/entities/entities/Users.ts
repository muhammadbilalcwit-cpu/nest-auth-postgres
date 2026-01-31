import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Sessions } from './Sessions';
import { UserRoles } from './UserRoles';
import { Companies } from './Companies';
import { Departments } from './Departments';
import { Roles } from './Roles';

@Index('users_email_key', ['email'], { unique: true })
@Index('users_pkey', ['id'], { unique: true })
@Entity('users', { schema: 'public' })
export class Users {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @Column('character varying', { name: 'email', unique: true, length: 255 })
  email: string;

  @Column('character varying', { name: 'password', length: 255 })
  password: string;

  @Column('text', { name: 'firstname', nullable: true })
  firstname: string | null;

  @Column('text', { name: 'lastname', nullable: true })
  lastname: string | null;

  @Column('integer', { name: 'age', nullable: true })
  age: number | null;

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
    name: 'is_active',
    nullable: false,
    default: () => 'true',
  })
  isActive: boolean;

  @Column('timestamp without time zone', {
    name: 'deactivated_at',
    nullable: true,
  })
  deactivatedAt: Date | null;

  @Column('boolean', {
    name: 'is_deleted',
    nullable: true,
    default: () => 'false',
  })
  isDeleted: boolean | null;

  @Column('timestamp without time zone', { name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @Column('character varying', {
    name: 'profile_picture',
    nullable: true,
    length: 500,
  })
  profilePicture: string | null;

  @OneToMany(() => Sessions, (sessions) => sessions.user)
  sessions: Sessions[];

  @OneToMany(() => UserRoles, (userRoles) => userRoles.user)
  userRoles: UserRoles[];

  @ManyToOne(() => Companies, (companies) => companies.users)
  @JoinColumn([{ name: 'company_id', referencedColumnName: 'id' }])
  company: Companies;

  @ManyToOne(() => Departments, (departments) => departments.users)
  @JoinColumn([{ name: 'department_id', referencedColumnName: 'id' }])
  department: Departments;

  @ManyToOne(() => Roles, (roles) => roles.users)
  @JoinColumn([{ name: 'role_id', referencedColumnName: 'id' }])
  role: Roles;
}
