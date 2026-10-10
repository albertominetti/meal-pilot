import { Injectable, Logger } from '@nestjs/common';
import type { CachedAnalysis } from './transcript-cache.service';

/**
 * Gemini integration with deterministic offline fallback.
 *
 * - If GEMINI_API_KEY is set, calls the Gemini API (gemini-1.5-flash) to
 *   analyze the video in the context of the user's health profile.
 * - Otherwise (local dev, CI, tests) uses a deterministic mock provider
 *   derived from title/channel/seed data so builds and tests never need
 *   network access or keys. Mock output is labeled provider: "mock".
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  provider(): 'gemini' | 'mock' {
    return this.isConfigured() ? 'gemini' : 'mock';
  }

  async analyzeVideo(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<Omit<CachedAnalysis, 'videoId' | 'analyzedAt'>> {
    if (this.isConfigured()) {
      try {
        return await this.analyzeWithGemini(videoId, title, channel);
      } catch (err) {
        this.logger.warn(
          `Gemini call failed for ${videoId}, falling back to mock analysis: ${err}`,
        );
      }
    }
    return this.mockAnalysis(title, channel);
  }

  private async analyzeWithGemini(
    videoId: string,
    title: string,
    channel: string,
  ): Promise<Omit<CachedAnalysis, 'videoId' | 'analyzedAt'>> {
    // Lazy import so the app boots without the key/package issues.
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = [
      `You are a nutrition-aware assistant analyzing a YouTube cooking video.`,
      `Video: "${title}" by ${channel} (id ${videoId}, https://www.youtube.com/watch?v=${videoId}).`,
      `From your knowledge of this public video (or general culinary reasoning if unknown), respond with STRICT JSON only, no markdown:`,
      `{"transcript":"brief reconstructed summary of the recipe","ingredients":["..."],"nutritionSignals":["low-sodium", ...],"detectedAllergens":["peanut", ...],"restrictionTags":["vegetarian", "vegan", "gluten-free", ...],"summary":"one-paragraph fit summary"}`,
      `Be conservative: when unsure whether an allergen is present, include it in detectedAllergens with an "uncertain:" prefix is NOT allowed — instead list the allergen and mention uncertainty in summary.`,
    ].join('\n');
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    return {
      title,
      channel,
      transcript: String(parsed.transcript ?? ''),
      ingredients: (parsed.ingredients ?? []).map(String),
      nutritionSignals: (parsed.nutritionSignals ?? []).map(String),
      detectedAllergens: (parsed.detectedAllergens ?? []).map(String),
      restrictionTags: (parsed.restrictionTags ?? []).map(String),
      summary: String(parsed.summary ?? ''),
      provider: 'gemini',
    };
  }

  /**
   * Deterministic offline analysis. Uses keyword signals from the
   * title/channel so demo + tests are stable without network.
   */
  mockAnalysis(
    title: string,
    channel: string,
  ): Omit<CachedAnalysis, 'videoId' | 'analyzedAt'> {
    const hay = `${title} ${channel}`.toLowerCase();
    const has = (...words: string[]) => words.some((w) => hay.includes(w));

    const ingredients: string[] = ['olive oil', 'garlic', 'vegetables', 'herbs'];
    const nutritionSignals: string[] = [];
    const detectedAllergens: string[] = [];
    const restrictionTags: string[] = [];

    if (has('vegan')) {
      restrictionTags.push('vegan', 'vegetarian', 'dairy-free');
      ingredients.push('chickpeas', 'leafy greens', 'lemon');
    } else if (has('vegetarian', 'veggie', 'lentil', 'salad', 'stir fry', 'stir-fry')) {
      restrictionTags.push('vegetarian');
      ingredients.push('lentils', 'brown rice');
    }
    if (has('chicken', 'salmon', 'fish', 'turkey', 'beef')) {
      ingredients.push(has('salmon', 'fish') ? 'salmon fillet' : 'lean protein');
      restrictionTags.push('high-protein');
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
    if (has('low carb', 'diabetes', 'keto')) nutritionSignals.push('low-carb');
    if (has('quick', '15-minute', '15 minute', 'easy', 'dinner')) {
      nutritionSignals.push('quick-prep');
    }
    nutritionSignals.push('whole-foods');
    if (has('peanut', 'satay', 'pad thai')) {
      ingredients.push('peanuts', 'peanut sauce');
      detectedAllergens.push('peanuts');
    }
    if (has('shrimp', 'shellfish', 'paella', 'seafood')) {
      ingredients.push('shrimp');
      detectedAllergens.push('shellfish');
    }
    if (has('cheese', 'cream', 'dairy')) detectedAllergens.push('milk');
    if (has('bread', 'pasta') && !has('gluten-free', 'gluten free')) {
      detectedAllergens.push('gluten');
    }

    const transcript =
      `Mock transcript for "${title}" by ${channel}: ` +
      `prepare ${ingredients.slice(0, 4).join(', ')}, season lightly, ` +
      `cook and serve. (Offline mock — set GEMINI_API_KEY for live Gemini analysis.)`;
    const summary =
      `Mock analysis of "${title}": ` +
      `${restrictionTags.length ? `tags ${restrictionTags.join(', ')}; ` : ''}` +
      `${nutritionSignals.length ? `signals ${nutritionSignals.join(', ')}; ` : ''}` +
      `${detectedAllergens.length ? `possible allergens: ${detectedAllergens.join(', ')}.` : 'no common allergens detected in mock data.'}`;

    return {
      title,
      channel,
      transcript,
      ingredients,
      nutritionSignals,
      detectedAllergens,
      restrictionTags,
      summary,
      provider: 'mock',
    };
  }
}
