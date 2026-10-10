import { Injectable } from '@nestjs/common';
import {
  AllergenEvidence,
  ANALYSIS_SCHEMA_VERSION,
  NutritionSignal,
  RestrictionTag,
  VideoAnalysis,
} from './analysis.schema';
import { VideoAnalyzer, VideoTarget } from './video-analyzer.interface';

@Injectable()
export class MockVideoAnalyzer implements VideoAnalyzer {
  provider(): 'gemini' | 'mock' {
    return 'mock';
  }

  model(): string {
    return 'mock';
  }

  async analyze(target: VideoTarget): Promise<VideoAnalysis> {
    const hay = `${target.title} ${target.channel}`.toLowerCase();
    const has = (...words: string[]) => words.some((w) => hay.includes(w));

    const ingredients = [
      { name: 'olive oil' },
      { name: 'garlic' },
      { name: 'vegetables' },
      { name: 'herbs' },
    ];
    const nutritionSignals: NutritionSignal[] = [];
    const allergens: AllergenEvidence[] = [];
    const restrictionTags: RestrictionTag[] = [];
    const sodiumSources: string[] = [];

    if (has('vegan')) {
      restrictionTags.push('vegan', 'vegetarian', 'dairy-free');
      ingredients.push(
        { name: 'chickpeas' },
        { name: 'leafy greens' },
        { name: 'lemon' },
      );
    } else if (
      has('vegetarian', 'veggie', 'lentil', 'salad', 'stir fry', 'stir-fry')
    ) {
      restrictionTags.push('vegetarian');
      ingredients.push({ name: 'lentils' }, { name: 'brown rice' });
    }

    if (has('chicken', 'salmon', 'fish', 'turkey', 'beef')) {
      ingredients.push(
        has('salmon', 'fish')
          ? { name: 'salmon fillet' }
          : { name: 'lean protein' },
      );
      restrictionTags.push('high-protein');
    }

    if (has('gluten-free', 'gluten free', 'quinoa', 'rice')) {
      restrictionTags.push('gluten-free');
    } else {
      ingredients.push({ name: 'whole-grain bread' });
    }

    if (has('low sodium', 'low-sodium', 'hypertension', 'blood pressure')) {
      nutritionSignals.push('low-sodium');
    } else {
      nutritionSignals.push('moderate-sodium');
      sodiumSources.push('table salt');
    }

    if (has('low carb', 'diabetes', 'keto')) {
      nutritionSignals.push('low-carb');
    }

    if (has('quick', '15-minute', '15 minute', 'easy', 'dinner')) {
      nutritionSignals.push('quick-prep');
    }

    nutritionSignals.push('whole-foods');

    if (has('peanut', 'satay', 'pad thai')) {
      ingredients.push({ name: 'peanuts' }, { name: 'peanut sauce' });
      allergens.push({
        allergen: 'peanuts',
        evidence: `Keyword match in "${target.title}" (peanut/satay/pad thai)`,
        confidence: 'confirmed',
      });
    }

    if (has('shrimp', 'shellfish', 'paella', 'seafood')) {
      ingredients.push({ name: 'shrimp' });
      allergens.push({
        allergen: 'crustaceans',
        evidence: `Keyword match in "${target.title}" (shrimp/shellfish/seafood)`,
        confidence: 'confirmed',
      });
    }

    if (has('cheese', 'cream', 'dairy')) {
      allergens.push({
        allergen: 'milk',
        evidence: `Keyword match in "${target.title}" (cheese/cream/dairy)`,
        confidence: 'confirmed',
      });
    }

    if (has('bread', 'pasta') && !has('gluten-free', 'gluten free')) {
      allergens.push({
        allergen: 'gluten',
        evidence: `Keyword match in "${target.title}" (bread/pasta)`,
        confidence: 'confirmed',
      });
    }

    const steps = [
      `Prepare ${ingredients.slice(0, 4).map((i) => i.name).join(', ')}`,
      'Season lightly and cook over medium heat',
      'Plate and serve immediately',
    ];

    const transcript =
      `Mock transcript for "${target.title}" by ${target.channel}: ` +
      `prepare ${ingredients.slice(0, 4).map((i) => i.name).join(', ')}, season lightly, ` +
      `cook and serve. (Offline mock — set GEMINI_API_KEY for live Gemini analysis.)`;

    const summary =
      `Mock analysis of "${target.title}": ` +
      `${restrictionTags.length ? `tags ${restrictionTags.join(', ')}; ` : ''}` +
      `${nutritionSignals.length ? `signals ${nutritionSignals.join(', ')}; ` : ''}` +
      `${allergens.length ? `possible allergens: ${allergens.map((a) => a.allergen).join(', ')}.` : 'no common allergens detected in mock data.'}`;

    return {
      videoId: target.videoId,
      title: target.title,
      channel: target.channel,
      recipeName: target.title,
      ingredients,
      steps,
      allergens,
      crossContactNotes: [],
      sodiumSources,
      nutritionSignals,
      restrictionTags,
      summary,
      coverage: 'full',
      status: 'ok',
      provider: 'mock',
      model: 'mock',
      analyzedAt: new Date().toISOString(),
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      transcript,
      detectedAllergens: allergens.map((a) => a.allergen),
    };
  }
}
