import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AppKeyGuard, RequireAppKeyForUserBody } from '../common/app-key.guard';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { PlansService } from '../plans/plans.service';

@ApiTags('meal-plan')
@Controller()
@UseGuards(AppKeyGuard)
export class AgentController {
  constructor(private readonly plans: PlansService) {}

  @Post('meal-plan/agent')
  @RequireAppKeyForUserBody()
  @ApiHeader({ name: 'x-api-key', required: false, description: 'Required when userId is set.' })
  @ApiOperation({
    summary: 'Autonomous agentic meal plan generation',
    description:
      'Runs a Gemini tool loop to search YouTube, analyze genuine videos, verify allergy safety server-side, and produce a personalized plan.',
  })
  @ApiQuery({
    name: 'debug',
    required: false,
    type: Boolean,
    description: 'When true, includes step-by-step tool trace in response',
  })
  async create(
    @Body() dto: MealPlanRequestDto,
    @Query('debug') debug?: string,
  ) {
    const isDebug = debug === 'true' || debug === '1';
    return this.plans.createWithAgent(dto, isDebug);
  }
}
