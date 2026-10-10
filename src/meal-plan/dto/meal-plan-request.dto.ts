import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ProfileFieldsDto } from './profile-fields.dto';

export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class MealPlanRequestDto extends ProfileFieldsDto {
  @ApiPropertyOptional({
    description:
      'Opaque JJFit user id. Loads the stored profile; profile fields sent inline override it. Requires the x-api-key header.',
    example: 'u_8f2c41',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(USER_ID_PATTERN)
  userId?: string;

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
