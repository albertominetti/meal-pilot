import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlansService } from '../plans/plans.service';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';

@ApiTags('meal-plan')
@Controller()
export class MealPlanController {
  constructor(private readonly plans: PlansService) {}

  @Post('meal-plan')
  create(@Body() dto: MealPlanRequestDto) {
    return this.plans.createDeterministic(dto);
  }
}
