import { UserController } from './users.controller';
import { UserService } from './users.service';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(() => {
    const mockUserService = {} as unknown as UserService;
    controller = new UserController(mockUserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
