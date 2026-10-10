/**
 * Allergy helpers. Safety-critical: normalization + matching must be
 * conservative (substring matching on normalized tokens).
 * Aligned with EU 14 major allergens (Regulation (EU) No 1169/2011).
 */

export const CANONICAL_ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'tree nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

export type CanonicalAllergen = (typeof CANONICAL_ALLERGENS)[number];

export const ALIAS_MAP: Record<CanonicalAllergen, string[]> = {
  peanuts: [
    'peanut',
    'peanuts',
    'groundnut',
    'groundnuts',
    'peanut butter',
    'peanut oil',
    'arachis oil',
  ],
  'tree nuts': [
    'tree nut',
    'tree nuts',
    'almond',
    'almonds',
    'walnut',
    'walnuts',
    'cashew',
    'cashews',
    'pecan',
    'pecans',
    'pistachio',
    'pistachios',
    'hazelnut',
    'hazelnuts',
    'brazil nut',
    'brazil nuts',
    'macadamia',
    'pine nut',
    'pine nuts',
    'chestnut',
    'chestnuts',
    'marzipan',
    'praline',
  ],
  milk: [
    'milk',
    'dairy',
    'cheese',
    'butter',
    'cream',
    'yogurt',
    'yoghurt',
    'whey',
    'casein',
    'lactose',
    'ghee',
    'curd',
    'custard',
  ],
  eggs: ['egg', 'eggs', 'albumin', 'mayonnaise', 'meringue', 'ovalbumin'],
  gluten: [
    'gluten',
    'wheat',
    'barley',
    'rye',
    'oats',
    'spelt',
    'kamut',
    'bread',
    'pasta',
    'flour',
    'seitan',
    'couscous',
    'semolina',
  ],
  soy: [
    'soy',
    'soya',
    'soybean',
    'soybeans',
    'tofu',
    'tempeh',
    'miso',
    'soy sauce',
    'edamame',
    'tamari',
    'shoyu',
  ],
  crustaceans: [
    'crustacean',
    'crustaceans',
    'shrimp',
    'prawn',
    'prawns',
    'crab',
    'lobster',
    'crawfish',
    'crayfish',
    'krill',
    'scampi',
    'shellfish',
  ],
  molluscs: [
    'mollusc',
    'molluscs',
    'mollusk',
    'mollusks',
    'clam',
    'clams',
    'mussel',
    'mussels',
    'oyster',
    'oysters',
    'scallop',
    'scallops',
    'squid',
    'calamari',
    'octopus',
    'snail',
    'escargot',
    'shellfish',
  ],
  fish: [
    'fish',
    'tuna',
    'salmon',
    'cod',
    'tilapia',
    'anchovy',
    'anchovies',
    'sardine',
    'sardines',
    'trout',
    'bass',
    'halibut',
    'haddock',
    'worcestershire',
  ],
  sesame: ['sesame', 'tahini', 'hummus', 'sesame oil', 'halva'],
  celery: ['celery', 'celeriac', 'celery stalk', 'celery seed', 'celery salt'],
  mustard: [
    'mustard',
    'dijon',
    'mustard seed',
    'mustard greens',
    'mustard powder',
  ],
  sulphites: [
    'sulphite',
    'sulphites',
    'sulfite',
    'sulfites',
    'sulphur dioxide',
    'sulfur dioxide',
    'e220',
    'e228',
  ],
  lupin: ['lupin', 'lupine', 'lupin flour', 'lupini beans'],
};

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expand a user allergy string into a set of searchable keywords. */
export function expandAllergy(allergy: string): string[] {
  const norm = normalizeToken(allergy);
  const out = new Set<string>([norm]);

  // Check alias map
  for (const [key, aliases] of Object.entries(ALIAS_MAP)) {
    const keyNorm = normalizeToken(key);
    if (norm === keyNorm || norm.includes(keyNorm) || keyNorm.includes(norm)) {
      out.add(keyNorm);
      aliases.forEach((a) => out.add(normalizeToken(a)));
    }
    for (const alias of aliases) {
      const aNorm = normalizeToken(alias);
      if (norm === aNorm || norm.includes(aNorm) || aNorm.includes(norm)) {
        out.add(aNorm);
        aliases.forEach((a) => out.add(normalizeToken(a)));
        out.add(keyNorm);
      }
    }
  }

  // Singular/plural variants
  for (const token of [...out]) {
    if (token.endsWith('s') && token.length > 3) {
      out.add(token.slice(0, -1));
    } else {
      out.add(`${token}s`);
    }
  }

  return [...out];
}

/**
 * Maps a user's free-text allergy declaration to canonical EU 14 allergens.
 * Returns multiple if ambiguous (e.g. "shellfish" maps to both crustaceans and molluscs).
 */
export function mapToCanonicalAllergens(userAllergy: string): CanonicalAllergen[] {
  const norm = normalizeToken(userAllergy);
  const matched = new Set<CanonicalAllergen>();

  for (const [canonical, aliases] of Object.entries(ALIAS_MAP) as [
    CanonicalAllergen,
    string[],
  ][]) {
    const keyNorm = normalizeToken(canonical);
    if (
      norm === keyNorm ||
      norm === `${keyNorm}s` ||
      keyNorm === `${norm}s` ||
      norm.includes(keyNorm) ||
      keyNorm.includes(norm)
    ) {
      matched.add(canonical);
    }
    for (const alias of aliases) {
      const aNorm = normalizeToken(alias);
      if (
        norm === aNorm ||
        norm === `${aNorm}s` ||
        aNorm === `${norm}s` ||
        norm.includes(aNorm)
      ) {
        matched.add(canonical);
      }
    }
  }

  return [...matched];
}

/**
 * Returns true when `haystack` (e.g. ingredient list joined) mentions any of
 * the allergy keywords as a whole-word/substring match.
 */
export function haystackMatchesAllergy(
  haystack: string,
  allergy: string,
): boolean {
  const hay = normalizeToken(haystack);
  if (!hay) return false;
  const padded = ` ${hay} `;
  for (const keyword of expandAllergy(allergy)) {
    if (!keyword) continue;
    if (padded.includes(` ${keyword} `) || hay.includes(keyword)) return true;
  }
  return false;
}

/** True if any of the user allergies matches the haystack. */
export function findAllergyMatches(
  haystack: string,
  allergies: string[],
): string[] {
  return (allergies ?? []).filter(
    (a) => a && a.trim() && haystackMatchesAllergy(haystack, a),
  );
}
