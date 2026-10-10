import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        service: 'meal-pilot',
        mode: 'mock',
        model: 'gemini-3.8-flash',
      },
    },
  })
  check() {
    return {
      status: 'ok',
      service: 'meal-pilot',
      mode: this.config.effectiveLlmMode,
      model: this.config.geminiModel,
    };
  }
}
