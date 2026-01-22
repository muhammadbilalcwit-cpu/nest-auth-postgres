import { UserService } from './users.service';
import { Repository } from 'typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { Companies } from '../entities/entities/Companies';
import { UserRoles } from '../entities/entities/UserRoles';
import { RolesService } from '../roles/roles.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SessionsService } from 'src/sessions/sessions.service';

describe('UserService', () => {
  let service: UserService;

  const createMockDependencies = (overrides?: {
    repo?: Partial<Repository<Users>>;
    deptRepo?: Partial<Repository<Departments>>;
    rolesService?: Partial<RolesService>;
  }) => {
    const fakeRepo = {
      save: jest.fn(),
      ...overrides?.repo,
    } as unknown as Repository<Users>;
    const fakeDeptRepo = {
      findOne: jest.fn(),
      ...overrides?.deptRepo,
    } as unknown as Repository<Departments>;
    const fakeCompanyRepo = {} as unknown as Repository<Companies>;
    const fakeRolesService = {
      ...overrides?.rolesService,
    } as unknown as RolesService;
    const fakeUserRolesRepo = {} as unknown as Repository<UserRoles>;
    const fakeActivityLogsService = {
      logForbiddenAccess: jest.fn(),
    } as unknown as ActivityLogsService;
    const fakeNotificationsGateway = {
      emitToCompany: jest.fn(),
    } as unknown as NotificationsGateway;
    const fakeSessions = {
      emitToCompany: jest.fn(),
    } as unknown as SessionsService;

    return {
      fakeRepo,
      fakeDeptRepo,
      fakeCompanyRepo,
      fakeRolesService,
      fakeUserRolesRepo,
      fakeActivityLogsService,
      fakeNotificationsGateway,
      fakeSessions,
    };
  };

  const createService = (deps: ReturnType<typeof createMockDependencies>) => {
    return new UserService(
      deps.fakeRepo,
      deps.fakeDeptRepo,
      deps.fakeCompanyRepo,
      deps.fakeRolesService,
      deps.fakeUserRolesRepo,
      deps.fakeActivityLogsService,
      deps.fakeNotificationsGateway,
      deps.fakeSessions,
    );
  };

  beforeEach(() => {
    const deps = createMockDependencies();
    service = createService(deps);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('company_admin cannot assign super_admin role', async () => {
    const deps = createMockDependencies({
      repo: { save: jest.fn() },
      deptRepo: {
        findOne: jest.fn().mockResolvedValue({ id: 1, company: { id: 1 } }),
      },
      rolesService: {
        findBySlug: jest
          .fn()
          .mockImplementation((slug: string) =>
            Promise.resolve({ id: 1, slug }),
          ),
      },
    });

    const svc = createService(deps);

    const requester: AuthUser = {
      id: 10,
      sub: 10,
      email: 'admin@test.com',
      roles: ['company_admin'],
      departmentId: 1,
    };

    await expect(
      svc.create(requester, {
        email: 'a@b.com',
        roleSlug: 'super_admin',
        departmentId: 1,
      }),
    ).rejects.toThrow();
  });

  it('manager sees only dept users', async () => {
    const deps = createMockDependencies({
      repo: {
        find: jest.fn().mockResolvedValue([{ id: 2, departmentId: 5 }]),
        createQueryBuilder: jest.fn().mockReturnValue({
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        }),
      },
      deptRepo: {
        findOne: jest.fn().mockResolvedValue({ id: 5, company: { id: 2 } }),
      },
    });

    const svc = createService(deps);

    const requester: AuthUser = {
      id: 20,
      sub: 20,
      email: 'manager@test.com',
      roles: ['manager'],
      departmentId: 5,
    };

    const users = await svc.findAllWithAccess(requester);
    expect(users).toBeDefined();
  });

  it('manager cannot access company_admin even if in same department', async () => {
    const deps = createMockDependencies({
      repo: {
        findOne: jest.fn().mockResolvedValue({
          id: 3,
          department: { id: 5 },
          role: { slug: 'company_admin' },
        }),
      },
    });

    const svc = createService(deps);

    const requester: AuthUser = {
      id: 20,
      sub: 20,
      email: 'manager@test.com',
      roles: ['manager'],
      departmentId: 5,
    };

    await expect(svc.findOneWithAccess(3, requester)).rejects.toThrow();
  });
});
