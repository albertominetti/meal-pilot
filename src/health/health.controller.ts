import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../db/database.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Always 200, so Render's health check never fails on a slow first query
   * after Neon scales to zero; a down database reports `degraded` instead.
   */
  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        service: 'meal-pilot',
        mode: 'mock',
        model: 'gemini-3.8-flash',
        db: 'disabled',
      },
    },
  })
  async check() {
    const db = await this.database.ping();
    return {
      status: db === 'down' ? 'degraded' : 'ok',
      service: 'meal-pilot',
      mode: this.config.effectiveLlmMode,
      model: this.config.geminiModel,
      db,
    };
  }
}
