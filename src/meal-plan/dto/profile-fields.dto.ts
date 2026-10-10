import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ArrayMaxSize,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Budget, BUDGETS, HEALTH_GOALS, HealthGoal } from '../profile-fit';

/**
 * The health profile, shared by inline meal-plan requests and stored
 * profiles (PUT /api/profile), so both validate the same way.
 */
export class ProfileFieldsDto {
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

  @ApiPropertyOptional({
    description: 'Health goals matched in code against the analysed recipes.',
    enum: HEALTH_GOALS,
    isArray: true,
    example: ['high-protein', 'low-sodium'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HEALTH_GOALS.length)
  @IsIn(HEALTH_GOALS, { each: true })
  healthGoals?: HealthGoal[];

  @ApiPropertyOptional({
    description: 'People eating; scales the shopping list.',
    default: 1,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  householdSize?: number;

  @ApiPropertyOptional({
    description:
      'Hard limit: recipes known to take longer are excluded (reason too_long). Unknown prep time is allowed with a note.',
    minimum: 5,
    maximum: 240,
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  maxCookMinutes?: number;

  @ApiPropertyOptional({
    description: 'Soft hint that steers the search only. There is no price data, so it never filters.',
    enum: BUDGETS,
  })
  @IsOptional()
  @IsIn(BUDGETS)
  budget?: Budget;

  @ApiPropertyOptional({ example: 'low sodium, quick dinners' })
  @IsOptional()
  @IsString()
  preferences?: string;
}
