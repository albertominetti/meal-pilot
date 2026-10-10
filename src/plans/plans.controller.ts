import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckedItemsDto, SwapMealDto } from '../users/dto/user-data.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans/:id')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.get(id);
  }

  @Patch('checked')
  @ApiOperation({ summary: 'Store which shopping-list items are ticked (by item key)' })
  setChecked(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckedItemsDto) {
    return this.plans.setChecked(id, dto.checked);
  }

  @Post('swap')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Replace one meal and update the shopping list',
    description:
      'Uses the best-ranked safe cached recipe when one fits (no Gemini call), otherwise a short single-slot agent run. Returns the new plan version.',
  })
  swap(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SwapMealDto) {
    return this.plans.swap(id, dto.videoId);
  }
}
