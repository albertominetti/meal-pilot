import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShoppingListDto, ShoppingListRequestDto } from './dto/shopping-list.dto';
import { ShoppingListService } from './shopping-list.service';

@ApiTags('shopping-list')
@Controller()
export class ShoppingListController {
  constructor(private readonly shoppingList: ShoppingListService) {}

  @Post('shopping-list')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Merged, scaled shopping list for analysed recipes',
    description:
      'Reads analyses from the cache (never calls Gemini). Amounts are scaled to the household, merged across recipes, rounded to buying units and grouped by supermarket section. Unclear amounts are flagged, never invented.',
  })
  @ApiOkResponse({ type: ShoppingListDto })
  create(@Body() dto: ShoppingListRequestDto): ShoppingListDto {
    return this.shoppingList.fromCache(dto);
  }
}
