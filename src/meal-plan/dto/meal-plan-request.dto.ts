import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ArrayMaxSize,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VideoCandidateDto {
  @ApiProperty({
    description: 'YouTube video id or full watch/shorts/embed URL',
    example: 'dQw4w9WgXcQ',
  })
  @IsString()
  @IsNotEmpty()
  idOrUrl!: string;

  @ApiPropertyOptional({ example: 'Low-Sodium Veggie Stir Fry' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Healthy Kitchen' })
  @IsOptional()
  @IsString()
  channel?: string;
}

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

  @ApiPropertyOptional({ type: [VideoCandidateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VideoCandidateDto)
  videoCandidates?: VideoCandidateDto[];

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxResults?: number;
}
