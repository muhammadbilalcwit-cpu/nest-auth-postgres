import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './users.service';
import { Repository } from 'typeorm';
import { Users } from '../entities/entities/Users';
import { Departments } from '../entities/entities/Departments';
import { RolesService } from '../roles/roles.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    const fakeRepo = { save: jest.fn() } as unknown as Repository<Users>;
    const fakeDeptRepo = {
      findOne: jest.fn(),
    } as unknown as Repository<Departments>;
    const fakeRolesService = {} as unknown as RolesService;

    service = new UserService(fakeRepo, fakeDeptRepo, fakeRolesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('company_admin cannot assign super_admin role', async () => {
    // mocks
    const fakeRepo = { save: jest.fn() } as unknown as Repository<Users>;
    const fakeDeptRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 1, company: { id: 1 } }),
    } as unknown as Repository<Departments>;
    const fakeRolesService = {
      findBySlug: jest
        .fn()
        .mockImplementation((slug: string) => Promise.resolve({ id: 1, slug })),
    } as unknown as RolesService;

    const svc = new UserService(fakeRepo, fakeDeptRepo, fakeRolesService);

    const requester: AuthUser = {
      id: 10,
      role: { id: 0, slug: 'company_admin', name: 'company_admin' },
      departmentId: 1,
    } as AuthUser;

    await expect(
      svc.create(requester, {
        email: 'a@b.com',
        roleSlug: 'super_admin',
        departmentId: 1,
      }),
    ).rejects.toThrow();
  });

  it('manager sees only dept users', async () => {
    const fakeRepo = {
      find: jest.fn().mockResolvedValue([{ id: 2, departmentId: 5 }]),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: () => ({ where: () => ({ getMany: () => [] }) }),
      }),
    } as unknown as Repository<Users>;
    const fakeDeptRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 5, company: { id: 2 } }),
    } as unknown as Repository<Departments>;
    const fakeRolesService = {} as unknown as RolesService;

    const svc = new UserService(fakeRepo, fakeDeptRepo, fakeRolesService);

    const users = await svc.findAllWithAccess({
      id: 20,
      role: { id: 0, slug: 'manager', name: 'manager' },
      departmentId: 5,
    } as AuthUser);
    expect(users).toBeDefined();
  });

  it('manager cannot access company_admin even if in same department', async () => {
    const fakeRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 3,
        department: { id: 5 },
        role: { slug: 'company_admin' },
      }),
    } as unknown as Repository<Users>;
    const fakeDeptRepo = { findOne: jest.fn() } as unknown as Repository<Departments>;
    const fakeRolesService = {} as unknown as RolesService;

    const svc = new UserService(fakeRepo, fakeDeptRepo, fakeRolesService);

    await expect(
      svc.findOneWithAccess(
        3,
        {
          id: 20,
          role: { id: 0, slug: 'manager', name: 'manager' },
          departmentId: 5,
        } as AuthUser,
      ),
    ).rejects.toThrow();
  });
});
