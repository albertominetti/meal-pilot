import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MealPlanResponseDto } from './dto/meal-plan-response.dto';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import { MealPlanService } from './meal-plan.service';

@ApiTags('meal-plan')
@Controller()
export class MealPlanController {
  constructor(private readonly mealPlan: MealPlanService) {}

  @Post('meal-plan')
  @ApiOperation({
    summary: 'Deterministic meal plan for the given (or seed) candidate videos',
    description: 'Analyzes candidates in order (Gemini video analysis in live mode, title-keyword mock otherwise) until maxResults safe matches are found.',
  })
  @ApiOkResponse({ type: MealPlanResponseDto })
  create(@Body() dto: MealPlanRequestDto): Promise<MealPlanResponseDto> {
    return this.mealPlan.buildPlan(dto);
  }
}
