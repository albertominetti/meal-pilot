import { normalizeIngredientName } from './normalize';

describe('normalizeIngredientName', () => {
  it.each([
    ['Chickpeas', 'chickpea'],
    ['garbanzo beans', 'chickpea'],
    ['Scallions', 'spring onion'],
    ['fresh chopped coriander', 'coriander'],
    ['finely diced onions', 'onion'],
    ['smoked paprika', 'smoked paprika'],
    ['dried oregano', 'dried oregano'],
    ['tomatoes', 'tomato'],
    ['berries', 'berry'],
    ['hummus', 'hummus'],
    ['extra virgin olive oil', 'olive oil'],
    ['vegetable broth', 'vegetable stock'],
    ['red onion (large)', 'red onion'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIngredientName(input)).toBe(expected);
  });
});
