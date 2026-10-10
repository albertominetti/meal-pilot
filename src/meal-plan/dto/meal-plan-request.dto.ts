import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ArrayMaxSize,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MealPlanRequestDto {
  @ApiPropertyOptional({
    description: 'Free-text health description',
    example: 'hypertension, type 2 diabetes, trying to eat low sodium',
  })
  @IsOptional()
  @IsString()
  healthProfile?: string;

  @ApiPropertyOptional({ example: '140/90' })
  @IsOptional()
  @IsString()
  bloodPressure?: string;

  @ApiPropertyOptional({ example: ['vegetarian', 'gluten-free'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  restrictions?: string[];

  @ApiPropertyOptional({ example: ['peanuts', 'shellfish'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ example: 'low sodium, quick dinners' })
  @IsOptional()
  @IsString()
  preferences?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  minResults?: number;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxResults?: number;
}
