import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LABEL_CHECK_NOTE } from '../../videos/analyzers/analysis.schema';

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

  @ApiProperty({
    type: [String],
    description: 'Store-bought ingredients whose product label should be checked for allergens.',
    example: ['curry paste', 'vegetable stock'],
  })
  labelCheck!: string[];

  @ApiPropertyOptional({ example: LABEL_CHECK_NOTE })
  labelCheckNote?: string;
}

export class ExcludedVideoDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty() reason!: string;
}

export class FailureDetailDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() reason!: string;
}

export class MealPlanMetaDto {
  @ApiProperty({ enum: ['live', 'mock'] })
  mode!: 'live' | 'mock';

  @ApiProperty({ enum: ['gemini', 'mock'] })
  provider!: 'gemini' | 'mock';

  @ApiProperty()
  model!: string;

  @ApiProperty()
  analyzed!: number;

  @ApiProperty()
  fromCache!: number;

  @ApiProperty({ type: [FailureDetailDto] })
  failures!: FailureDetailDto[];
}

export class MealPlanResponseDto {
  @ApiProperty({ type: [RecommendationDto] })
  recommendations!: RecommendationDto[];

  @ApiProperty({ type: [ExcludedVideoDto] })
  excluded!: ExcludedVideoDto[];

  @ApiProperty()
  disclaimer!: string;

  @ApiPropertyOptional({ type: MealPlanMetaDto })
  meta?: MealPlanMetaDto;
}

export const MEDICAL_DISCLAIMER =
  'Informational only, not medical advice. Consult a qualified health professional before changing your diet, especially with hypertension, diabetes, allergies, or other conditions.';

/** Informational product-label note; present only when there is something to check. */
export function labelCheckFields(analysis?: {
  labelCheck?: string[];
}): Pick<RecommendationDto, 'labelCheck' | 'labelCheckNote'> {
  const labelCheck = analysis?.labelCheck ?? [];
  return labelCheck.length
    ? { labelCheck, labelCheckNote: LABEL_CHECK_NOTE }
    : { labelCheck };
}
