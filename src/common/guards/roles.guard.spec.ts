import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthUser } from '../interfaces/auth-user.interface';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

describe('RolesGuard', () => {
  let guard: RolesGuard;

  function makeContext(user: Partial<AuthUser>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows when no roles required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const ctx = makeContext({});

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when user has matching role slug (case-insensitive required role)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const user = { roles: ['super_admin'] };
    const ctx = makeContext(user as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies when user roles do not match required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company_admin']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const user = { roles: ['manager'] };
    const ctx = makeContext(user as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies when user has no roles array', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company_admin']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const ctx = makeContext({} as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows when DB stores uppercase slug and required is lowercase', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['super_admin']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const user = { roles: ['SUPER_ADMIN'] };
    const ctx = makeContext(user as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when JWT roles array contains matching slug (case-insensitive)', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['company_admin']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const user = { roles: ['COMPANY_ADMIN'] };
    const ctx = makeContext(user as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when required includes manager and user has manager role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['manager']),
    } as unknown as Reflector;
    const mockActivityLogService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    guard = new RolesGuard(reflector, mockActivityLogService);

    const user = { roles: ['MANAGER'] };
    const ctx = makeContext(user as Partial<AuthUser>);

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
