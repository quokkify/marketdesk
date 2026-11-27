import { parseOlxAdvertDelivery } from '../olxAdvertPage';

function page(state: unknown): string {
  return `<script>window.__PRERENDERED_STATE__= ${JSON.stringify(JSON.stringify(state))};</script>`;
}

describe('parseOlxAdvertDelivery', () => {
  it('reads the delivery mode of the advert', () => {
    const html = page({ ad: { ad: { delivery: { rock: { mode: 'BuyWithDelivery' } } } } });
    expect(parseOlxAdvertDelivery(html)).toBe('BuyWithDelivery');
  });

  it('returns null for a page without state', () => {
    expect(parseOlxAdvertDelivery('<html></html>')).toBeNull();
  });

  it('returns null when the delivery block is missing or malformed', () => {
    expect(parseOlxAdvertDelivery(page({ ad: { ad: {} } }))).toBeNull();
    expect(parseOlxAdvertDelivery(page({ ad: { ad: { delivery: { rock: { mode: 5 } } } } }))).toBeNull();
    expect(parseOlxAdvertDelivery('window.__PRERENDERED_STATE__= "not json";')).toBeNull();
  });
});
