import { Controller, Get, Optional } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppConfig } from '../config/app-config.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Optional() private readonly config: AppConfig = new AppConfig()) {}

  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        service: 'meal-pilot',
        llm: { mode: 'live', modeSetting: 'auto', model: 'gemini-3.8-flash', analysisModel: 'gemini-3.8-flash', youtubeSearch: true },
      },
    },
  })
  check() {
    return { status: 'ok', service: 'meal-pilot', llm: this.config.describe() };
  }
}
