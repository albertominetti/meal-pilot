import { Injectable } from '@nestjs/common';
import {
  InteractionRequest,
  InteractionResult,
  InteractionStep,
  LlmClient,
} from './llm-client.interface';

@Injectable()
export class MockLlmClient implements LlmClient {
  private cannedResponses: InteractionResult[] = [];

  queueResponse(res: InteractionResult): void {
    this.cannedResponses.push(res);
  }

  async createInteraction(req: InteractionRequest): Promise<InteractionResult> {
    if (this.cannedResponses.length > 0) {
      return this.cannedResponses.shift()!;
    }

    // Default mock behavior for structured or unstructured input
    if (req.response_format?.schema) {
      return {
        outputText: JSON.stringify({
          recipeName: 'Mock Dish',
          prepMinutes: 25,
          servings: 2,
          mainProtein: 'none',
          cuisine: 'european',
          mealType: ['dinner'],
          ingredients: [
            {
              name: 'olive oil',
              quantity: 1,
              unit: 'tbsp',
              rawText: '1 tbsp olive oil',
              confidence: 'high',
              source: 'video',
              packaged: false,
            },
            {
              name: 'mixed vegetable',
              quantity: 300,
              unit: 'g',
              rawText: '300g vegetables',
              confidence: 'medium',
              source: 'video',
              packaged: false,
            },
          ],
          steps: ['Chop vegetables', 'Cook in olive oil'],
          allergens: [],
          crossContactNotes: [],
          sodiumSources: [],
          nutritionSignals: ['whole-foods'],
          restrictionTags: ['vegetarian'],
          summary: 'Mock analysis summary',
          coverage: 'full',
        }),
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'Mock dish generated' }],
          },
        ],
      };
    }

    const steps: InteractionStep[] = [
      {
        type: 'model_output',
        content: [{ type: 'text', text: 'Mock LLM response' }],
      },
    ];

    return {
      outputText: 'Mock LLM response',
      steps,
    };
  }
}
