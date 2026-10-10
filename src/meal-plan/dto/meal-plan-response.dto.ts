import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AllergySafetyDto {
  @ApiProperty({ enum: ['safe', 'uncertain', 'unsafe'] })
  status!: 'safe' | 'uncertain' | 'unsafe';

  @ApiProperty()
  notes!: string;
}

export class RecommendationDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty() channel!: string;
  @ApiProperty() whyItFits!: string;
  @ApiProperty() matchedTags!: string[];
  @ApiProperty({ type: AllergySafetyDto }) allergySafety!: AllergySafetyDto;
  @ApiProperty() healthNotes!: string;
  @ApiPropertyOptional({ enum: ['gemini', 'mock'] }) provider?: 'gemini' | 'mock';
}

export class ExcludedVideoDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty() reason!: string;
}

export class AnalysisFailureDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() error!: string;
}

export class MealPlanMetaDto {
  @ApiProperty({ enum: ['live', 'mock'] }) mode!: 'live' | 'mock';
  @ApiProperty({ enum: ['gemini', 'mock'] }) provider!: 'gemini' | 'mock';
  @ApiProperty() model!: string;
  @ApiProperty() analyzed!: number;
  @ApiProperty() fromCache!: number;
  @ApiProperty({ type: [AnalysisFailureDto] }) failures!: AnalysisFailureDto[];
  @ApiProperty() durationMs!: number;
}

export class MealPlanResponseDto {
  @ApiProperty({ type: [RecommendationDto] }) recommendations!: RecommendationDto[];
  @ApiProperty({ type: [ExcludedVideoDto] }) excluded!: ExcludedVideoDto[];
  @ApiProperty() disclaimer!: string;
  @ApiProperty({ type: MealPlanMetaDto }) meta!: MealPlanMetaDto;
}

export const MEDICAL_DISCLAIMER =
  'Informational only, not medical advice. Consult a qualified health professional before changing your diet, especially with hypertension, diabetes, allergies, or other conditions. Video and allergen analysis is AI-generated and may be incomplete: always check the full recipe and product labels.';
