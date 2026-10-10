import { Body, Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MealPlanRequestDto } from '../meal-plan/dto/meal-plan-request.dto';
import { AgentService } from './agent.service';

@ApiTags('meal-plan')
@Controller()
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('meal-plan/agent')
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
    return this.agentService.run(dto, isDebug);
  }
}
