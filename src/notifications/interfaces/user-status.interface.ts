import type { SessionDetails } from './session.interface';

export interface UserStatusPayload {
  userId: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
  isOnline: boolean;
  companyId: number;
}

export interface OnlineUserInfo {
  id: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
  isOnline: boolean;
}

export interface OnlineUserWithSessions {
  id: number;
  email: string;
  firstname: string | null;
  lastname: string | null;
  sessions: SessionDetails[];
}
