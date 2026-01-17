export interface AuthUser {
  id: number;
  sub: number;
  email: string;
  companyId?: number;
  departmentId?: number;
  roles: string[];
}
