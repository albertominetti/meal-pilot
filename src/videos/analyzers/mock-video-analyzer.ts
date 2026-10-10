import { Injectable } from '@nestjs/common';
import {
  ANALYSIS_SCHEMA_VERSION,
  AllergenFindingT,
  VideoAnalysis,
  VideoRef,
} from '../analysis.schema';
import type { VideoAnalyzer } from './video-analyzer';

/**
 * Deterministic offline analysis (MEALPILOT_LLM_MODE=mock, CI, tests).
 * Uses keyword signals from title/channel only — it never sees the video, so
 * results are marked `coverage: "partial"` and safety evaluation treats
 * severe allergies as uncertain.
 */
@Injectable()
export class MockVideoAnalyzer implements VideoAnalyzer {
  readonly provider = 'mock' as const;

  model(): string {
    return 'mock';
  }

  async analyze(ref: VideoRef): Promise<VideoAnalysis> {
    return mockAnalysis(ref);
  }
}

export function mockAnalysis(ref: VideoRef): VideoAnalysis {
  const { title, channel } = ref;
  const hay = `${title} ${channel}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => hay.includes(w));

  const ingredients: string[] = ['olive oil', 'garlic', 'vegetables', 'herbs'];
  const nutritionSignals: string[] = [];
  const allergens: AllergenFindingT[] = [];
  const restrictionTags: string[] = [];
  const sodiumSources: string[] = [];
  const kw = (allergen: AllergenFindingT['allergen'], word: string): AllergenFindingT => ({
    allergen,
    evidence: `title/channel keyword "${word}" (mock)`,
    confidence: 'likely',
  });

  if (has('vegan')) {
    restrictionTags.push('vegan', 'vegetarian', 'dairy-free');
    ingredients.push('chickpeas', 'leafy greens', 'lemon');
  } else if (has('vegetarian', 'veggie', 'lentil', 'salad', 'stir fry', 'stir-fry')) {
    restrictionTags.push('vegetarian');
    ingredients.push('lentils', 'brown rice');
  }
  if (has('chicken', 'salmon', 'fish', 'turkey', 'beef')) {
    if (has('salmon', 'fish')) {
      ingredients.push('salmon fillet');
      allergens.push(kw('fish', has('salmon') ? 'salmon' : 'fish'));
    } else {
      ingredients.push('lean protein');
    }
    nutritionSignals.push('high-protein');
  }
  if (has('gluten-free', 'gluten free', 'quinoa', 'rice')) {
    restrictionTags.push('gluten-free');
  } else {
    ingredients.push('whole-grain bread');
  }
  if (has('low sodium', 'low-sodium', 'hypertension', 'blood pressure')) {
    nutritionSignals.push('low-sodium');
  } else {
    nutritionSignals.push('moderate-sodium');
  }
  if (has('stir fry', 'stir-fry', 'teriyaki')) sodiumSources.push('soy sauce');
  if (has('low carb', 'diabetes', 'keto')) nutritionSignals.push('low-carb');
  if (has('quick', '15-minute', '15 minute', 'easy', 'dinner')) nutritionSignals.push('quick-prep');
  nutritionSignals.push('whole-foods');
  if (has('peanut', 'satay', 'pad thai')) {
    ingredients.push('peanuts', 'peanut sauce');
    allergens.push(kw('peanuts', has('peanut') ? 'peanut' : has('satay') ? 'satay' : 'pad thai'));
  }
  if (has('shrimp', 'shellfish', 'paella', 'seafood', 'prawn')) {
    ingredients.push('shrimp');
    allergens.push(kw('crustaceans', 'shrimp/seafood'));
  }
  if (has('cheese', 'cream', 'dairy')) allergens.push(kw('milk', 'cheese/cream/dairy'));
  if (has('bread', 'pasta') && !has('gluten-free', 'gluten free')) {
    allergens.push(kw('gluten', 'bread/pasta'));
  }

  const summary =
    `Mock analysis of "${title}" (title keywords only — set GEMINI_API_KEY for real video analysis): ` +
    `${restrictionTags.length ? `tags ${restrictionTags.join(', ')}; ` : ''}` +
    `signals ${nutritionSignals.join(', ')}.`;

  return {
    ...ref,
    status: 'ok',
    provider: 'mock',
    model: 'mock',
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analyzedAt: new Date().toISOString(),
    recipeName: title,
    ingredients: ingredients.map((name) => ({ name })),
    steps: [`Prepare ${ingredients.slice(0, 4).join(', ')}, season lightly, cook and serve. (mock)`],
    allergens,
    crossContactNotes: [],
    sodiumSources,
    nutritionSignals,
    restrictionTags,
    summary,
    coverage: 'partial',
  };
}
