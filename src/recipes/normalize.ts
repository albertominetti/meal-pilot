/**
 * Ingredient name normalisation for merging shopping-list lines.
 * Lowercase, singular, aliases resolved, preparation descriptors removed.
 * Words that change the product ("smoked", "dried", "canned") are kept.
 */

const ALIASES: Record<string, string> = {
  garbanzo: 'chickpea',
  'garbanzo bean': 'chickpea',
  scallion: 'spring onion',
  'green onion': 'spring onion',
  cilantro: 'coriander',
  capsicum: 'bell pepper',
  aubergine: 'eggplant',
  courgette: 'zucchini',
  'vegetable broth': 'vegetable stock',
  'chicken broth': 'chicken stock',
  'extra virgin olive oil': 'olive oil',
  'extra-virgin olive oil': 'olive oil',
};

const DESCRIPTORS = new Set([
  'fresh',
  'freshly',
  'chopped',
  'finely',
  'roughly',
  'diced',
  'minced',
  'sliced',
  'grated',
  'crushed',
  'peeled',
  'large',
  'small',
  'medium',
  'ripe',
  'organic',
  'whole',
  'raw',
  'cooked',
  'drained',
  'rinsed',
  'optional',
  'to',
  'taste',
  'of',
]);

const KEEP_PLURAL = new Set(['hummus', 'couscous', 'asparagus', 'molasses', 'swiss', 'grass', 'oats', 'lemongrass']);

export function singularize(word: string): string {
  if (KEEP_PLURAL.has(word) || word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

export function normalizeIngredientName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !DESCRIPTORS.has(w));
  if (words.length === 0) return name.toLowerCase().trim();
  words[words.length - 1] = singularize(words[words.length - 1]);
  const joined = words.join(' ');
  return ALIASES[joined] ?? joined;
}
