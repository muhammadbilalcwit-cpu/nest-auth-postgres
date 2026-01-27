export interface JwtPayload {
  sub: number;
  email: string;
  companyId?: number;
  departmentId?: number;
  roles: string[];
  sessionId?: number;
}
