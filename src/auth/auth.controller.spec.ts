import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    const mockAuthService = {} as unknown as AuthService;
    const mockJwtService = {} as unknown as JwtService;
    controller = new AuthController(mockAuthService, mockJwtService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
