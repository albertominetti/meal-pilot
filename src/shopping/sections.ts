export const SECTIONS = [
  'produce',
  'dairy & eggs',
  'meat & fish',
  'bakery',
  'dry goods & grains',
  'canned & jars',
  'spices & condiments',
  'frozen',
  'other',
] as const;
export type Section = (typeof SECTIONS)[number];

/** First match wins, so more specific patterns come first. */
const SECTION_RULES: Array<[RegExp, Section]> = [
  [/\bfrozen\b/, 'frozen'],
  [/coconut milk|\bstock\b|\bbroth\b|paste|passata|tinned|canned|\bcan\b|pesto|tahini|peanut butter|chickpea|kidney bean|black bean|cannellini/, 'canned & jars'],
  [/soy sauce|tamari|vinegar|mustard|ketchup|\bsauce\b|cumin|paprika|turmeric|curry powder|garam masala|chili flake|chilli flake|oregano|cinnamon|spice|\bsalt\b|pepper flake|black pepper|bay leaf|honey|maple syrup|\boil\b/, 'spices & condiments'],
  [/chicken|beef|pork|lamb|turkey|bacon|sausage|salmon|tuna|cod|fish|shrimp|prawn|mussel|squid/, 'meat & fish'],
  [/milk|cheese|yogurt|yoghurt|butter|cream|\begg\b|feta|parmesan|mozzarella|ricotta|tofu|tempeh/, 'dairy & eggs'],
  [/bread|baguette|tortilla|pita|wrap|bun\b|roll\b/, 'bakery'],
  [/rice|pasta|noodle|quinoa|couscous|oat|flour|lentil|bulgur|barley|sugar|\bnut\b|almond|walnut|cashew|seed|raisin|dried/, 'dry goods & grains'],
  [/onion|garlic|ginger|carrot|potato|tomato|pepper|spinach|kale|lettuce|cucumber|zucchini|eggplant|broccoli|cauliflower|cabbage|mushroom|celery|leek|avocado|lemon|lime|apple|banana|berry|herb|coriander|parsley|basil|mint|chili|chilli|spring onion|green|squash|pumpkin|corn|pea\b|bean sprout|vegetable/, 'produce'],
];

export function sectionFor(name: string): Section {
  for (const [pattern, section] of SECTION_RULES) {
    if (pattern.test(name)) return section;
  }
  return 'other';
}

/** Things most kitchens already have; shown in a collapsible group. */
const PANTRY = /^(salt|sea salt|black pepper|water|olive oil|vegetable oil|oil|sunflower oil|cumin|paprika|turmeric|chili flake|chilli flake|oregano|dried oregano|cinnamon|bay leaf|sugar|flour)$/;

export function isPantryStaple(name: string): boolean {
  return PANTRY.test(name);
}
