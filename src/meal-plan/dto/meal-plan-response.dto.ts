import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  INGREDIENT_CONFIDENCE,
  INGREDIENT_SOURCES,
  INGREDIENT_UNITS,
  IngredientConfidence,
  IngredientSource,
  LABEL_CHECK_NOTE,
  MAIN_PROTEINS,
  MainProtein,
  MEAL_TYPES,
  MealType,
  Unit,
} from '../../videos/analyzers/analysis.schema';
import { HEALTH_GOALS, HealthGoal } from '../profile-fit';
import { watchUrl } from '../../videos/youtube.util';

export class AllergySafetyDto {
  @ApiProperty({ enum: ['safe', 'uncertain', 'unsafe'] })
  status!: 'safe' | 'uncertain' | 'unsafe';

  @ApiProperty()
  notes!: string;
}

export class RecipeIngredientDto {
  @ApiProperty({ example: 'chickpea' }) name!: string;
  @ApiProperty({ type: Number, nullable: true, example: 400 }) quantity!: number | null;
  @ApiProperty({ type: String, nullable: true, enum: INGREDIENT_UNITS }) unit!: Unit | null;
  @ApiProperty({ example: '1 can (400g) chickpeas, drained' }) rawText!: string;
  @ApiProperty({ enum: INGREDIENT_CONFIDENCE }) confidence!: IngredientConfidence;
  @ApiProperty({ enum: INGREDIENT_SOURCES }) source!: IngredientSource;
  @ApiProperty() packaged!: boolean;
  @ApiPropertyOptional() timestamp?: string;
}

export class RecipeDto {
  @ApiProperty() recipeName!: string;
  @ApiPropertyOptional() servings?: number;
  @ApiPropertyOptional() prepMinutes?: number;
  @ApiPropertyOptional({ enum: MAIN_PROTEINS }) mainProtein?: MainProtein;
  @ApiPropertyOptional() cuisine?: string;
  @ApiProperty({ enum: MEAL_TYPES, isArray: true }) mealType!: MealType[];
  @ApiProperty({ enum: ['full', 'partial'] }) coverage!: 'full' | 'partial';
  @ApiProperty({ type: [RecipeIngredientDto] }) ingredients!: RecipeIngredientDto[];
  @ApiProperty({ type: [String] }) steps!: string[];
  @ApiProperty({ type: [String] }) labelCheck!: string[];
  @ApiProperty({
    type: [String],
    description: 'Model-estimated nutrition signals, not measured values.',
  })
  estimatedNutritionSignals!: string[];
}

export class GoalEvidenceDto {
  @ApiProperty({ enum: HEALTH_GOALS }) goal!: HealthGoal;
  @ApiProperty({ type: [String], example: ['chickpea 400 g', 'tofu 200 g'] }) ingredients!: string[];
  @ApiPropertyOptional() note?: string;
}

export class EvidenceDto {
  @ApiProperty({ type: [GoalEvidenceDto] }) goals!: GoalEvidenceDto[];
  @ApiProperty({ description: 'Allergy check evidence notes.' }) allergens!: string;
  @ApiProperty({ enum: ['model-signals'] }) basis!: 'model-signals';
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

  @ApiProperty() trustedChannel!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Against maxCookMinutes; null when the limit or prep time is unknown.',
  })
  fitsTime!: boolean | null;

  @ApiProperty({ type: RecipeDto, description: 'The extracted recipe, so the app needs no Gemini call.' })
  recipe!: RecipeDto;

  @ApiProperty({ type: EvidenceDto, description: 'Server-built evidence shown next to whyItFits.' })
  evidence!: EvidenceDto;
}

export const EXCLUSION_CODES = ['allergen', 'uncertain', 'unavailable', 'too_long'] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

export class ExcludedVideoDto {
  @ApiProperty() videoId!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: EXCLUSION_CODES }) code!: ExclusionCode;
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

export function excludedVideo(
  videoId: string,
  title: string,
  code: ExclusionCode,
  detail: string,
): ExcludedVideoDto {
  const prefix: Record<ExclusionCode, string> = {
    allergen: 'Blocked',
    uncertain: 'Needs review',
    unavailable: 'Needs review',
    too_long: 'Too long',
  };
  return {
    videoId,
    url: watchUrl(videoId),
    title,
    reason: `${prefix[code]}: ${detail}`,
    code,
  };
}

/** Exclusion for a non-safe allergy verdict. */
export function excludedForSafety(
  videoId: string,
  title: string,
  verdict: { status: 'safe' | 'uncertain' | 'unsafe'; notes: string },
): ExcludedVideoDto {
  return excludedVideo(
    videoId,
    title,
    verdict.status === 'unsafe' ? 'allergen' : 'uncertain',
    verdict.notes,
  );
}
