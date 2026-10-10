import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';
import { MealPlanService } from './meal-plan.service';

@ApiTags('meal-plan')
@Controller()
export class MealPlanController {
  constructor(private readonly mealPlan: MealPlanService) {}

  @Post('meal-plan')
  create(@Body() dto: MealPlanRequestDto) {
    return this.mealPlan.buildPlan(dto);
  }
}
