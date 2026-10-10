import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentService } from './agent.service';
import { AgentMealPlanRequestDto, AgentMealPlanResponseDto } from './dto/agent-meal-plan.dto';

@ApiTags('meal-plan')
@Controller()
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('meal-plan/agent')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Agentic meal plan (Gemini searches, analyzes and selects videos)',
    description:
      'Gemini drives YouTube search and video analysis via function calling. Allergy verdicts and plan validation are enforced server-side. Falls back to the deterministic planner in mock mode or on failure (see agent.fallbackUsed). Can take 30-150 s.',
  })
  @ApiOkResponse({ type: AgentMealPlanResponseDto })
  create(@Body() dto: AgentMealPlanRequestDto): Promise<AgentMealPlanResponseDto> {
    return this.agent.run(dto);
  }
}
