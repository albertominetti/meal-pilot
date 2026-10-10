import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AppKeyGuard, RequireAppKeyForUserBody } from '../common/app-key.guard';
import { PlansService } from '../plans/plans.service';
import { MealPlanRequestDto } from './dto/meal-plan-request.dto';

@ApiTags('meal-plan')
@Controller()
@UseGuards(AppKeyGuard)
export class MealPlanController {
  constructor(private readonly plans: PlansService) {}

  @Post('meal-plan')
  @RequireAppKeyForUserBody()
  @ApiHeader({ name: 'x-api-key', required: false, description: 'Required when userId is set.' })
  create(@Body() dto: MealPlanRequestDto) {
    return this.plans.createDeterministic(dto);
  }
}
