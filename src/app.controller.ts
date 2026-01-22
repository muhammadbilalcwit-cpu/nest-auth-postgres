import { Controller } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * Root application controller.
 *
 * Currently does not expose any HTTP endpoints but is reserved
 * for future health-check or root-level routes.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
}
