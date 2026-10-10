import * as fs from 'fs';
import * as path from 'path';
import { FdcFood, parseFood, RawFood } from './fdc-food';
import { pickFood } from './food-match';

/** Recorded FDC search responses (Foundation + SR Legacy), trimmed to the fields we read. */
function hits(name: string): FdcFood[] {
  const file = path.join(__dirname, '../../test/fixtures/fdc', `search_${name.replace(/ /g, '_')}.json`);
  return (JSON.parse(fs.readFileSync(file, 'utf8')).foods as RawFood[]).map(parseFood);
}

describe('pickFood on recorded FDC searches', () => {
  // FDC's own top hit is in the comment: relevance alone often picks the wrong product form.
  it.each([
    ['chickpea', false, 173756], // top hit: Chickpea flour (besan)
    ['chickpea', true, 173800], // canned, drained solids
    ['onion', false, 170000], // Onions, raw
    ['garlic', false, 169230], // Garlic, raw (SR Legacy, full nutrient profile)
    ['tomato', true, 170051], // top hit: Tomato powder; canned picks canned tomatoes, not purée
    ['lentil', false, 172420], // Lentils, raw
    ['carrot', false, 170393], // top hit: Carrot, dehydrated
    ['olive oil', false, 171413], // top hit: Oil, corn, peanut, and olive
  ])('%s (canned: %s) -> %s', (name, canned, fdcId) => {
    expect(pickFood(name, { canned }, hits(name))?.fdcId).toBe(fdcId);
  });

  it.each([
    ['coconut milk'], // only the sweetened beverage and puddings: needs an override
    ['vegetable stock'], // only beef, chicken and fish stock
  ])('%s has no confident match', (name) => {
    expect(pickFood(name, { canned: false }, hits(name))).toBeNull();
  });

  it('skips foods without energy or protein values', () => {
    const food: FdcFood = { fdcId: 1, description: 'Oil, olive, extra virgin', dataType: 'Foundation', nutrients: {}, portions: [] };
    expect(pickFood('olive oil', { canned: false }, [food])).toBeNull();
  });
});
