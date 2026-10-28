import { aiDraftCaption } from './aiDraftCaption';

describe('aiDraftCaption', () => {
  it('labels a draft Hermes did not produce as a heuristic draft, with no confidence', () => {
    expect(aiDraftCaption({ mode: 'title', source: 'offline', confidence: null })).toBe(
      'Heuristic draft (Hermes offline)'
    );
  });

  it('shows where a Hermes draft came from and its confidence', () => {
    expect(aiDraftCaption({ mode: 'photos', source: 'hermes', confidence: 0.537 })).toBe(
      'Draft from photos · confidence 54%'
    );
  });

  it('leaves the confidence out when a Hermes draft has none', () => {
    expect(aiDraftCaption({ mode: 'title', source: 'hermes', confidence: null })).toBe(
      'Draft from title'
    );
  });
});
