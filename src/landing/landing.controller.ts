import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Service landing page: redirect GET / to the Swagger UI.
 * Excluded from the global /api prefix (see main.ts) and from Swagger docs,
 * so every /api/* route is untouched.
 */
@ApiExcludeController()
@Controller()
export class LandingController {
  @Get()
  @Redirect('/api/docs', 302)
  redirectToDocs(): void {
    return;
  }
}
