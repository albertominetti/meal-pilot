import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { MealPlanRequestDto } from '../../meal-plan/dto/meal-plan-request.dto';
import { MealPlanResponseDto } from '../../meal-plan/dto/meal-plan-response.dto';

export class AgentMealPlanRequestDto extends MealPlanRequestDto {
  @ApiPropertyOptional({
    description: 'BCP-47 language for search queries and explanations (default: en)',
    example: 'de',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
  locale?: string;

  @ApiPropertyOptional({ description: 'Include the agent tool-call trace in the response', default: false })
  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}

export class AgentTraceEntryDto {
  @ApiProperty() step!: number;
  @ApiProperty() tool!: string;
  @ApiProperty() args!: Record<string, unknown>;
  @ApiProperty() ok!: boolean;
  @ApiProperty() summary!: string;
  @ApiProperty() durationMs!: number;
}

export class AgentMetaDto {
  @ApiProperty() steps!: number;
  @ApiProperty() searches!: number;
  @ApiProperty() analyses!: number;
  @ApiProperty() fallbackUsed!: boolean;
  @ApiPropertyOptional() fallbackReason?: string;
  @ApiPropertyOptional() agentNotes?: string;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() youtubeQuotaUsed!: number;
}

export class AgentMealPlanResponseDto extends MealPlanResponseDto {
  @ApiProperty({ type: AgentMetaDto }) agent!: AgentMetaDto;
  @ApiPropertyOptional({ type: [AgentTraceEntryDto] }) trace?: AgentTraceEntryDto[];
}
