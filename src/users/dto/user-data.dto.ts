import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProfileFieldsDto } from '../../meal-plan/dto/profile-fields.dto';

export class ProfileDto extends ProfileFieldsDto {
  @ApiProperty({
    description:
      'Explicit consent to store this health profile (GDPR Art. 9). Must be true; the time of consent is recorded.',
    enum: [true],
  })
  @IsBoolean()
  @Equals(true, { message: 'consent must be true to store a health profile' })
  consent!: true;
}

export class MealLogDto {
  @ApiProperty({ example: 'jfKL8pQjBCA' })
  @IsString()
  @MaxLength(64)
  videoId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  planId?: string;

  @ApiProperty({ description: 'Whether the user cooked it.' })
  @IsBoolean()
  cooked!: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Rated 1: never recommended again. 2 or lower: the agent avoids it. 4-5: brought back now and then.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CheckedItemsDto {
  @ApiProperty({ type: [String], example: ['chickpea|g', 'spring onion|bunch'], description: 'Shopping-list item keys that are ticked.' })
  @IsArray()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  checked!: string[];
}

export class SwapMealDto {
  @ApiProperty({ description: 'The recipe in the plan to replace.', example: 'jfKL8pQjBCA' })
  @IsString()
  @MaxLength(64)
  videoId!: string;
}
