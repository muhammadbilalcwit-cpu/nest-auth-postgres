import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Roles } from './Roles';
import { Users } from './Users';

@Index('user_roles_pkey', ['id'], { unique: true })
@Entity('user_roles', { schema: 'public' })
export class UserRoles {
  @PrimaryGeneratedColumn({ type: 'integer', name: 'id' })
  id: number;

  @ManyToOne(() => Roles, (roles) => roles.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'role_id', referencedColumnName: 'id' }])
  role: Roles;

  @ManyToOne(() => Users, (users) => users.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn([{ name: 'user_id', referencedColumnName: 'id' }])
  user: Users;
}
