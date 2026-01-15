import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    const mockAuthService = {} as unknown as any;
    controller = new AuthController(mockAuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
