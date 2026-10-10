import { VideoAnalysis } from '../videos/analyzers/analysis.schema';
import { nutritionFacts } from './nutrition-facts';
import { NutrientTotals } from './nutrition';

function summary(n: NutrientTotals): string {
  return `${n.kcal} kcal, ${n.protein} g protein, ${n.carbs} g carbs, ${n.fat} g fat, ${n.fiber} g fibre, ${n.sodium} mg sodium`;
}

/** One sentence on what the app knows about a recipe's nutrients, and how sure it is. */
export function nutritionNote(analysis: VideoAnalysis): string {
  const n = analysis.nutrition;
  const facts = nutritionFacts(analysis);
  const pct = n ? Math.round(n.completeness * 100) : 0;

  if (facts.basis === 'nutrients' && n?.perServing) {
    return `Per serving (USDA FoodData Central estimate, ${pct}% of the recipe resolved): ${summary(n.perServing)}.`;
  }
  if (n?.perServing) {
    return `Partial estimate per serving (only ${pct}% of the recipe resolved, so goals aren't matched on it): ${summary(n.perServing)}.`;
  }
  if (n) {
    return `Nutrients estimated for the whole recipe only (servings unknown, ${pct}% resolved).`;
  }
  if (n === null) return 'Nutrients are unavailable right now (food database unreachable).';
  if (facts.basis === 'model') {
    return `Estimated signals (model, not measured): ${facts.signals.join(', ')}.`;
  }
  return 'Nutrients not calculated.';
}
