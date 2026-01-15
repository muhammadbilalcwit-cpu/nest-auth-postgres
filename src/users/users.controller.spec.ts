import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './users.controller';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(() => {
    const mockUserService = {} as unknown as any;
    controller = new UserController(mockUserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
