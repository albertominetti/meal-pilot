import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SECTIONS } from '../sections';
import type { Section } from '../sections';

export class ShoppingListRecipeRequestDto {
  @ApiProperty({ example: 'veg-low-sodium-01' })
  @IsString()
  @MaxLength(64)
  videoId!: string;

  @ApiPropertyOptional({ description: 'Servings wanted from this recipe; defaults to householdSize.', minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  servings?: number;
}

export class ShoppingListRequestDto {
  @ApiProperty({ type: [ShoppingListRecipeRequestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ShoppingListRecipeRequestDto)
  items!: ShoppingListRecipeRequestDto[];

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  householdSize?: number;
}

export class ShoppingListItemDto {
  @ApiProperty({ example: 'chickpea' }) name!: string;
  @ApiProperty({ type: Number, nullable: true, example: 400, description: 'Rounded to a buying unit.' })
  amount!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'g' }) unit!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 380, description: 'Scaled amount before rounding.' })
  exactAmount!: number | null;
  @ApiProperty({ description: 'Some or all of the amount is unclear: check the recipe.' }) uncertain!: boolean;
  @ApiPropertyOptional({ example: 'amount unclear: check recipe' }) note?: string;
  @ApiProperty({ type: [String] }) fromRecipes!: string[];
}

export class ShoppingListSectionDto {
  @ApiProperty({ enum: SECTIONS }) section!: Section;
  @ApiProperty({ type: [ShoppingListItemDto] }) items!: ShoppingListItemDto[];
}

export class ShoppingListDto {
  @ApiProperty() householdSize!: number;
  @ApiProperty({ type: [ShoppingListSectionDto] }) sections!: ShoppingListSectionDto[];
  @ApiProperty({ type: [ShoppingListItemDto], description: 'Pantry staples ("you probably have this").' })
  pantry!: ShoppingListItemDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
