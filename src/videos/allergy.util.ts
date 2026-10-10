/**
 * Allergy helpers. Safety-critical: normalization + matching must be
 * conservative (substring matching on normalized tokens).
 */

const ALIAS_MAP: Record<string, string[]> = {
  peanut: ['peanut', 'peanuts', 'groundnut', 'groundnuts'],
  tree_nut: [
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
    'macadamia',
    'pine nut',
    'chestnut',
    'tree nut',
    'tree nuts',
  ],
  milk: ['milk', 'dairy', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'whey', 'lactose', 'ghee'],
  egg: ['egg', 'eggs'],
  wheat: ['wheat', 'bread', 'pasta', 'flour', 'couscous', 'bulgur', 'seitan'],
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'seitan', 'couscous'],
  soy: ['soy', 'soya', 'tofu', 'tempeh', 'miso', 'soy sauce', 'edamame'],
  shellfish: [
    'shrimp',
    'prawn',
    'prawns',
    'crab',
    'lobster',
    'clam',
    'clams',
    'mussel',
    'mussels',
    'oyster',
    'oysters',
    'scallop',
    'shellfish',
  ],
  fish: ['fish', 'tuna', 'salmon', 'cod', 'tilapia', 'anchovy', 'sardine', 'seafood'],
  sesame: ['sesame', 'tahini', 'hummus'],
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
  for (const [key, aliases] of Object.entries(ALIAS_MAP)) {
    const keyNorm = normalizeToken(key.replace(/_/g, ' '));
    if (norm === keyNorm || norm.includes(keyNorm) || keyNorm.includes(norm)) {
      aliases.forEach((a) => out.add(normalizeToken(a)));
    }
    for (const alias of aliases) {
      const aNorm = normalizeToken(alias);
      if (norm === aNorm || norm.includes(aNorm)) {
        out.add(aNorm);
        aliases.forEach((a) => out.add(normalizeToken(a)));
        out.add(keyNorm);
      }
    }
  }
  // naive singular/plural variants
  for (const token of [...out]) {
    if (token.endsWith('s') && token.length > 3) out.add(token.slice(0, -1));
    else out.add(`${token}s`);
  }
  return [...out];
}

/**
 * Returns true when `haystack` (e.g. ingredient list joined) mentions any of
 * the allergy keywords as a whole-word/substring match.
 */
export function haystackMatchesAllergy(haystack: string, allergy: string): boolean {
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
export function findAllergyMatches(haystack: string, allergies: string[]): string[] {
  return (allergies ?? []).filter(
    (a) => a && a.trim() && haystackMatchesAllergy(haystack, a),
  );
}
