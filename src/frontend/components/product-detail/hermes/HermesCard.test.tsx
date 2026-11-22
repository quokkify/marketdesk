import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { lightTheme } from '../../../theme/lightTheme';
import { HermesCard } from './HermesCard';
import type { HermesCardRow, HermesCardState } from './hermesCardModel';

const ROWS: HermesCardRow[] = [
  { key: 'prices', tab: 'prices', title: 'Market prices', status: 'ok', value: 'Start 169 zł', detail: 'Floor 155 zł · 4 prices' },
  { key: 'price', tab: 'checks', title: 'Price', status: 'bad', value: '280 zł → 169 zł', detail: 'Uses the market prices from 4 min ago' },
  { key: 'info', tab: 'checks', title: 'Info', status: 'ok', value: '', detail: 'Complete' },
  { key: 'photos', tab: 'checks', title: 'Photos', status: 'attention', value: '1', detail: 'Add at least 3 photos' },
  { key: 'suggestions', tab: 'suggestions', title: 'Suggestions', status: 'idle', value: '0', detail: 'None waiting' },
];

function state(overrides: Partial<HermesCardState> = {}): HermesCardState {
  return {
    chip: { label: 'Not analysed', color: 'default', outlined: false },
    lead: 'Hermes has not looked at this product yet.',
    primary: { kind: 'analyze', label: 'Analyze product' },
    showAnalyzeAgain: false,
    rows: ROWS,
    footer: 'No runs yet',
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof HermesCard>> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <HermesCard
        state={state()}
        analyzeDisabledReason={null}
        busy={false}
        onAnalyze={() => undefined}
        onSetPrice={() => undefined}
        onOpen={() => undefined}
        {...props}
      />
    </ThemeProvider>
  );
}

// The opening tag of the element carrying the test id.
function tagOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) throw new Error(`no element with data-testid="${testId}"`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

describe('HermesCard', () => {
  it('renders five rows with their test ids', () => {
    const html = render();

    for (const key of ['prices', 'price', 'info', 'photos', 'suggestions']) {
      expect(tagOf(html, `hermes-row-${key}`)).toMatch(/^<button/);
    }
    expect(html).toContain('data-testid="hermes-card"');
    expect(html).toContain('data-testid="hermes-history-link"');
    expect(html).toContain('No runs yet');
  });

  it('a set_price state renders the primary label and the Analyze again button', () => {
    const html = render({
      state: state({
        chip: { label: 'Not ready', color: 'warning', outlined: false },
        lead: 'The price is above the fair ceiling.',
        primary: { kind: 'set_price', label: 'Set price to 169 zł', eventId: 'event-1' },
        showAnalyzeAgain: true,
      }),
    });

    expect(tagOf(html, 'hermes-primary-action')).toMatch(/^<button/);
    expect(html).toMatch(/data-testid="hermes-primary-action"[^>]*>Set price to 169 zł</);
    expect(html).toMatch(/data-testid="hermes-analyze-again"[^>]*>Analyze again</);
    expect(html).toMatch(/data-testid="hermes-chip"[\s\S]*Not ready/);
    expect(html).toMatch(/data-testid="hermes-lead"[^>]*>The price is above the fair ceiling.</);
  });

  it('analyzeDisabledReason is shown and disables the analyze button', () => {
    const reason = 'The listing SEO agent is switched off for this workspace.';
    const html = render({ analyzeDisabledReason: reason });

    expect(html).toContain(reason);
    expect(tagOf(html, 'hermes-primary-action')).toContain('disabled');
  });

  it('the price row sits directly after the prices row', () => {
    const html = render();
    const order = [...html.matchAll(/data-testid="hermes-row-([a-z]+)"/g)].map((match) => match[1]);

    expect(order).toEqual(['prices', 'price', 'info', 'photos', 'suggestions']);
  });

  it('names every row by its status, title, value and detail, not by colour alone', () => {
    const html = render();
    const priceRow = html.slice(html.indexOf('data-testid="hermes-row-price"'), html.indexOf('data-testid="hermes-row-info"'));
    const text = priceRow.replace(/<[^>]+>/g, ' ');

    expect(text).toContain('Needs a fix');
    expect(text).toContain('Price');
    expect(text).toContain('280 zł → 169 zł');
    expect(text).toContain('Uses the market prices from 4 min ago');
    expect(text).toContain('✗');
  });

  it('busy disables every action button', () => {
    const html = render({
      busy: true,
      state: state({ primary: { kind: 'set_price', label: 'Set price to 169 zł', eventId: 'event-1' }, showAnalyzeAgain: true }),
    });

    expect(tagOf(html, 'hermes-primary-action')).toContain('disabled');
    expect(tagOf(html, 'hermes-analyze-again')).toContain('disabled');
  });

  it('renders no action button while nothing can be started', () => {
    const html = render({ state: state({ primary: { kind: 'none' }, showAnalyzeAgain: false }) });

    expect(html).not.toContain('hermes-primary-action');
    expect(html).not.toContain('hermes-analyze-again');
  });
});
