export interface SessionDetails {
  id: number;
  browser: string;
  os: string;
  ipAddress: string | null;
  loginAt: Date;
  lastActivityAt: Date;
}

export interface SessionInfo {
  sessionId: number;
  socketId: string;
  browser: string;
  os: string;
  ip: string;
  connectedAt: Date;
}

export interface SessionEventPayload {
  sessionId: number;
  userId: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
  browser: string;
  os: string;
  ipAddress: string | null;
  loginAt: Date;
  lastActivityAt: Date;
  companyId: number;
}

export interface SessionRemovedPayload {
  sessionId: number;
  userId: number;
  companyId: number;
}

export interface SessionExpiredPayload {
  sessionId: number;
  reason: 'expired' | 'revoked' | 'logout';
  message: string;
}
