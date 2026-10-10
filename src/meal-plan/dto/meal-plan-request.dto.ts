import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ProfileFieldsDto } from './profile-fields.dto';

/** Profile fields sent inline override the stored profile (PUT /api/profile), except allergies, which are merged. */
export class MealPlanRequestDto extends ProfileFieldsDto {
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
