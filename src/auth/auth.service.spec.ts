import { AuthService } from './auth.service';
import { UserService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { RolesService } from '../roles/roles.service';
import { SessionsService } from '../sessions/sessions.service';
import { SignupDto } from './dto/signup.dto';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    const mockUserService = {
      create: jest.fn().mockResolvedValue(true),
    } as unknown as UserService;
    const mockJwtService = { sign: jest.fn() } as unknown as JwtService;
    const mockRolesService = {
      findBySlug: jest.fn().mockResolvedValue({ id: 4, slug: 'user' }),
    } as unknown as RolesService;
    const mockSessionsService = {} as unknown as SessionsService;

    service = new AuthService(
      mockUserService,
      mockJwtService,
      mockRolesService,
      mockSessionsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('assigns default user role on signup', async () => {
    const mockUserService = {
      create: jest.fn().mockResolvedValue(true),
    } as unknown as UserService;
    const mockJwtService = { sign: jest.fn() } as unknown as JwtService;
    const mockRolesService = {
      findBySlug: jest.fn().mockResolvedValue({ id: 4, slug: 'user' }),
    } as unknown as RolesService;
    const mockSessionsService = {} as unknown as SessionsService;

    const s = new AuthService(
      mockUserService,
      mockJwtService,
      mockRolesService,
      mockSessionsService,
    );

    await s.signup({ email: 'a@b.com', password: '12345678' } as SignupDto);

    expect(mockRolesService.findBySlug).toHaveBeenCalledWith('user');
    expect(mockUserService.create).toHaveBeenCalled();
  });
});
