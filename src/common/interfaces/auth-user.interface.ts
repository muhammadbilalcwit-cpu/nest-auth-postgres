export interface AuthUser {
  id: number;
  sub: number;
  email: string;
  departmentId?: number;
  roles: string[];
}
