import { Users } from '../../entities/entities/Users';

export interface UserWithRoles extends Users {
  roles?: { id: number; name: string; slug: string }[];
}

export interface UserRole {
  role: {
    slug: string;
  };
}
