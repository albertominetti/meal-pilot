/**
 * Allergy helpers. Safety-critical: normalization + matching must be
 * conservative (substring matching on normalized tokens). False positives
 * (over-blocking) are acceptable; false negatives are not.
 */
import type { CanonicalAllergen } from './analysis.schema';

interface AllergyGroup {
  /** Group key; matched against the user's free-text allergy. */
  key: string;
  /** EU-14 canonical allergens this group maps to. */
  canonical: CanonicalAllergen[];
  aliases: string[];
}

const CRUSTACEANS = ['shrimp', 'shrimps', 'prawn', 'prawns', 'crab', 'lobster', 'crayfish', 'langoustine', 'crustacean', 'crustaceans'];
const MOLLUSCS = ['clam', 'clams', 'mussel', 'mussels', 'oyster', 'oysters', 'scallop', 'scallops', 'squid', 'calamari', 'octopus', 'snail', 'escargot', 'mollusc', 'molluscs', 'mollusk', 'mollusks'];

const GROUPS: AllergyGroup[] = [
  { key: 'peanuts', canonical: ['peanuts'], aliases: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'peanut butter', 'satay', 'arachis'] },
  {
    key: 'tree_nuts',
    canonical: ['tree_nuts'],
    aliases: [
      'almond', 'almonds', 'walnut', 'walnuts', 'cashew', 'cashews', 'pecan', 'pecans',
      'pistachio', 'pistachios', 'hazelnut', 'hazelnuts', 'brazil nut', 'macadamia',
      'pine nut', 'chestnut', 'tree nut', 'tree nuts', 'marzipan', 'praline', 'pesto', 'nutella',
    ],
  },
  {
    key: 'milk',
    canonical: ['milk'],
    aliases: [
      'milk', 'dairy', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'whey', 'lactose', 'ghee',
      'casein', 'buttermilk', 'paneer', 'mozzarella', 'parmesan', 'feta', 'ricotta',
    ],
  },
  { key: 'eggs', canonical: ['eggs'], aliases: ['egg', 'eggs', 'mayonnaise', 'mayo', 'aioli', 'meringue'] },
  { key: 'wheat', canonical: ['gluten'], aliases: ['wheat', 'bread', 'pasta', 'flour', 'couscous', 'bulgur', 'seitan', 'spelt', 'breadcrumbs', 'panko'] },
  {
    key: 'gluten',
    canonical: ['gluten'],
    aliases: ['gluten', 'wheat', 'barley', 'rye', 'spelt', 'bread', 'pasta', 'flour', 'seitan', 'couscous', 'bulgur', 'breadcrumbs', 'panko', 'soy sauce'],
  },
  { key: 'soybeans', canonical: ['soybeans'], aliases: ['soy', 'soya', 'soybean', 'soybeans', 'tofu', 'tempeh', 'miso', 'soy sauce', 'edamame', 'tamari'] },
  { key: 'shellfish', canonical: ['crustaceans', 'molluscs'], aliases: [...CRUSTACEANS, ...MOLLUSCS, 'shellfish'] },
  { key: 'crustaceans', canonical: ['crustaceans'], aliases: CRUSTACEANS },
  { key: 'molluscs', canonical: ['molluscs'], aliases: MOLLUSCS },
  {
    key: 'fish',
    canonical: ['fish'],
    aliases: ['fish', 'tuna', 'salmon', 'cod', 'tilapia', 'anchovy', 'anchovies', 'sardine', 'mackerel', 'trout', 'haddock', 'halibut', 'fish sauce', 'worcestershire', 'seafood'],
  },
  { key: 'sesame', canonical: ['sesame'], aliases: ['sesame', 'tahini', 'hummus', 'gomasio'] },
  { key: 'celery', canonical: ['celery'], aliases: ['celery', 'celeriac', 'celery salt', 'celery seed'] },
  { key: 'mustard', canonical: ['mustard'], aliases: ['mustard', 'dijon', 'mustard seed'] },
  { key: 'lupin', canonical: ['lupin'], aliases: ['lupin', 'lupine', 'lupini'] },
  { key: 'sulphites', canonical: ['sulphites'], aliases: ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulfur dioxide', 'sulphur dioxide', 'wine'] },
];

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupsFor(allergy: string): AllergyGroup[] {
  const norm = normalizeToken(allergy);
  if (!norm) return [];
  const out: AllergyGroup[] = [];
  for (const g of GROUPS) {
    const keyNorm = normalizeToken(g.key.replace(/_/g, ' '));
    const keyHit = norm === keyNorm || norm.includes(keyNorm) || keyNorm.includes(norm);
    const aliasHit = g.aliases.some((a) => {
      const aNorm = normalizeToken(a);
      return norm === aNorm || norm.includes(aNorm);
    });
    if (keyHit || aliasHit) out.push(g);
  }
  return out;
}

/** Expand a user allergy string into a set of searchable keywords. */
export function expandAllergy(allergy: string): string[] {
  const norm = normalizeToken(allergy);
  const out = new Set<string>(norm ? [norm] : []);
  for (const g of groupsFor(allergy)) {
    out.add(normalizeToken(g.key.replace(/_/g, ' ')));
    g.aliases.forEach((a) => out.add(normalizeToken(a)));
  }
  // naive singular/plural variants
  for (const token of [...out]) {
    if (token.endsWith('s') && token.length > 3) out.add(token.slice(0, -1));
    else out.add(`${token}s`);
  }
  return [...out];
}

/** Map a user's free-text allergy to EU-14 canonical allergens (may be empty). */
export function canonicalAllergensFor(allergy: string): CanonicalAllergen[] {
  const set = new Set<CanonicalAllergen>();
  for (const g of groupsFor(allergy)) g.canonical.forEach((c) => set.add(c));
  return [...set];
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

/** The user allergies that match the haystack. */
export function findAllergyMatches(haystack: string, allergies: string[]): string[] {
  return (allergies ?? []).filter(
    (a) => a && a.trim() && haystackMatchesAllergy(haystack, a),
  );
}

/** Allergies considered severe enough that partial analysis coverage is not acceptable. */
export const SEVERE_ALLERGY_PATTERN =
  /peanut|tree.?nut|nut|almond|walnut|cashew|hazelnut|pistachio|shellfish|shrimp|prawn|crustacean|mollus|fish|sesame|milk|dairy|egg|soy|lupin|mustard|celery/i;
