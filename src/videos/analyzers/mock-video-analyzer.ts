import { Injectable } from '@nestjs/common';
import {
  AllergenEvidence,
  ANALYSIS_SCHEMA_VERSION,
  deriveLabelCheck,
  Ingredient,
  INGREDIENT_UNITS,
  MainProtein,
  NutritionSignal,
  RestrictionTag,
  Unit,
  VideoAnalysis,
} from './analysis.schema';
import { VideoAnalyzer, VideoTarget } from './video-analyzer.interface';

const PACKAGED_PATTERN = /stock|broth|paste|sauce|pesto|peanut butter|coconut milk|tahini/;

const UNIT_ALIASES: Record<string, Unit> = {
  cans: 'can',
  cloves: 'clove',
  cups: 'cup',
  slices: 'slice',
  pieces: 'piece',
  bunches: 'bunch',
};

function ing(
  name: string,
  quantity: number | null,
  unit: Unit | null,
  rawText: string,
  extra: Partial<Ingredient> = {},
): Ingredient {
  return {
    name,
    quantity,
    unit,
    rawText,
    confidence: quantity === null ? 'low' : 'high',
    source: 'video',
    packaged: PACKAGED_PATTERN.test(name),
    ...extra,
  };
}

function singular(word: string): string {
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Parses "200g brown lentils, 2 cloves garlic, 1 can (400g) chickpeas" style
 * ingredient lists. Good enough for offline fixtures; Gemini does the real work.
 */
export function parseDescriptionIngredients(description: string): Ingredient[] {
  const body = description.replace(/^[\s\S]*?ingredients:/i, '');
  const units = [...INGREDIENT_UNITS, ...Object.keys(UNIT_ALIASES)]
    .sort((a, b) => b.length - a.length)
    .join('|');
  const pattern = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${units})?\\b\\s*(.+)$`, 'i');

  const out: Ingredient[] = [];
  for (const piece of body.split(/[,\n]|\.\s/)) {
    const rawText = piece.trim().replace(/\.$/, '');
    const match = rawText.match(pattern);
    if (!match) continue;
    const quantity = Number(match[1]);
    const rawUnit = match[2]?.toLowerCase();
    const unit: Unit = rawUnit
      ? (UNIT_ALIASES[rawUnit] ?? (rawUnit as Unit))
      : 'piece';
    const words = match[3]
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .trim()
      .split(/\s+/);
    if (words.length === 0 || !words[0]) continue;
    words[words.length - 1] = singular(words[words.length - 1]);
    out.push(ing(words.join(' '), quantity, unit, rawText, { source: 'description' }));
  }
  return out;
}

@Injectable()
export class MockVideoAnalyzer implements VideoAnalyzer {
  provider(): 'gemini' | 'mock' {
    return 'mock';
  }

  model(): string {
    return 'mock';
  }

  async analyze(target: VideoTarget): Promise<VideoAnalysis> {
    const description = target.description ?? '';
    const titleHay = `${target.title} ${target.channel}`.toLowerCase();
    const hay = `${titleHay} ${description}`.toLowerCase();
    const has = (...words: string[]) => words.some((w) => hay.includes(w));
    const titleHas = (...words: string[]) => words.some((w) => titleHay.includes(w));

    const fromDescription = parseDescriptionIngredients(description);
    const ingredients: Ingredient[] = fromDescription.length
      ? fromDescription
      : [
          ing('olive oil', 1, 'tbsp', '1 tbsp olive oil'),
          ing('garlic', 2, 'clove', '2 cloves minced garlic'),
          ing('vegetable broth', 500, 'ml', '500ml vegetable broth', {
            source: 'description',
            packaged: true,
          }),
        ];
    const nutritionSignals: NutritionSignal[] = [];
    const allergens: AllergenEvidence[] = [];
    const restrictionTags: RestrictionTag[] = [];
    const sodiumSources: string[] = [];
    let mainProtein: MainProtein = 'none';

    if (titleHas('vegan')) {
      restrictionTags.push('vegan', 'vegetarian', 'dairy-free');
      if (!fromDescription.length) {
        ingredients.push(
          ing('chickpea', 400, 'g', '1 can (400g) chickpeas', { packaged: true }),
          ing('leafy green', 100, 'g', '100g leafy greens'),
          ing('lemon', 1, 'piece', '1 lemon'),
        );
      }
    } else if (
      titleHas('vegetarian', 'veggie', 'lentil', 'salad', 'stir fry', 'stir-fry') &&
      !titleHas('chicken', 'beef', 'pork', 'turkey', 'salmon', 'fish', 'shrimp')
    ) {
      restrictionTags.push('vegetarian');
      if (!fromDescription.length) {
        ingredients.push(
          ing('lentil', 200, 'g', '200g lentils'),
          ing('brown rice', 150, 'g', '150g brown rice'),
        );
      }
    }

    if (titleHas('chicken', 'salmon', 'fish', 'turkey', 'beef')) {
      if (!fromDescription.length) {
        ingredients.push(
          titleHas('salmon', 'fish')
            ? ing('salmon fillet', 2, 'piece', '2 salmon fillets')
            : ing('chicken breast', 300, 'g', '300g chicken breast'),
        );
      }
      restrictionTags.push('high-protein');
    }

    if (titleHas('gluten-free', 'gluten free', 'quinoa', 'rice')) {
      restrictionTags.push('gluten-free');
    } else if (!fromDescription.length) {
      ingredients.push(ing('whole-grain bread', 2, 'slice', '2 slices whole-grain bread'));
    }

    if (titleHas('low sodium', 'low-sodium', 'hypertension', 'blood pressure')) {
      nutritionSignals.push('low-sodium');
    } else {
      nutritionSignals.push('moderate-sodium');
      sodiumSources.push('table salt');
    }

    if (titleHas('low carb', 'diabetes', 'keto')) {
      nutritionSignals.push('low-carb');
    }

    if (titleHas('quick', '15-minute', '15 minute', 'easy', 'dinner')) {
      nutritionSignals.push('quick-prep');
    }

    nutritionSignals.push('whole-foods');

    if (has('peanut', 'satay', 'pad thai')) {
      if (!ingredients.some((i) => /peanut/.test(i.name))) {
        ingredients.push(ing('peanut', 50, 'g', '50g peanuts'));
      }
      allergens.push({
        allergen: 'peanuts',
        evidence: `Keyword match in title or description of "${target.title}" (peanut/satay/pad thai)`,
        confidence: 'confirmed',
      });
    }

    if (has('shrimp', 'shellfish', 'paella', 'seafood')) {
      ingredients.push(ing('shrimp', 200, 'g', '200g shrimp'));
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

    if (titleHas('bread', 'pasta') && !titleHas('gluten-free', 'gluten free')) {
      allergens.push({
        allergen: 'gluten',
        evidence: `Keyword match in "${target.title}" (bread/pasta)`,
        confidence: 'confirmed',
      });
    }

    const names = ingredients.map((i) => i.name).join(' ');
    if (/chicken|turkey/.test(names) || titleHas('chicken', 'turkey')) mainProtein = 'chicken';
    else if (/salmon|fish/.test(names)) mainProtein = 'fish';
    else if (/tofu/.test(names) || titleHas('tofu')) mainProtein = 'tofu';
    else if (/chickpea/.test(names)) mainProtein = 'chickpea';
    else if (/lentil/.test(names)) mainProtein = 'lentil';
    else if (/beef/.test(names)) mainProtein = 'beef';
    else if (/shrimp/.test(names)) mainProtein = 'seafood';
    else if (/bean/.test(names)) mainProtein = 'bean';

    if (['tofu', 'chickpea', 'lentil'].includes(mainProtein)) {
      nutritionSignals.push('high-protein');
    }

    const cuisine = has('curry', 'masala', 'dal')
      ? 'indian'
      : has('stir fry', 'stir-fry', 'satay', 'wok', 'thai')
        ? 'asian'
        : has('quinoa', 'buddha', 'tahini')
          ? 'middle-eastern'
          : 'mediterranean';

    const minutesMatch = hay.match(/(\d{1,3})[\s-]?minute/);
    const prepMinutes = minutesMatch
      ? Number(minutesMatch[1])
      : has('quick', '15-minute', '15 minute')
        ? 15
        : 35;
    const servingsMatch = description.match(/serves\s+(\d+)/i);
    const servings = servingsMatch ? Number(servingsMatch[1]) : 2;

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
      channelId: target.channelId,
      recipeName: target.title,
      servings,
      prepMinutes,
      mainProtein,
      cuisine,
      mealType: ['lunch', 'dinner'],
      ingredients,
      steps,
      allergens,
      crossContactNotes: [],
      sodiumSources,
      nutritionSignals,
      restrictionTags,
      summary,
      coverage: 'full',
      labelCheck: deriveLabelCheck(ingredients),
      nutritionSignalsSource: 'model',
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
