import React from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { renderToStaticMarkup } from 'react-dom/server';
import { lightTheme } from '../../../theme/lightTheme';
import { formatDateTime } from '../../../utils/formatters';
import { HistoryTab, EMPTY_MESSAGE, PAGE_SIZE } from './HistoryTab';
import { formatDuration } from './hermesHistory';
import type { HistoryEntry } from './hermesHistory';

function entry(index: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `entry-${index}`,
    at: new Date(Date.UTC(2026, 10, 22, 10, 0, 0) - index * 3_600_000).toISOString(),
    title: 'Analysis',
    startedBy: 'you',
    durationMs: 48_000,
    outcome: { label: 'Ready to sell', tone: 'success' },
    steps: [
      { label: 'Price check', status: 'ok', detail: 'Price is fair' },
      { label: 'Photos check', status: 'bad', detail: 'Only one photo' },
      { label: 'Info check', status: 'none', detail: 'Not checked' },
    ],
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof HistoryTab>> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <HistoryTab entries={[]} loading={false} onRetry={() => undefined} {...props} />
    </ThemeProvider>
  );
}

describe('HistoryTab', () => {
  it('an entry renders its title, starter, duration and outcome', () => {
    const first = entry(0, { startedBy: 'autopilot' });
    const html = render({ entries: [first] });

    expect(html).toContain('data-testid="history-entry"');
    expect(html).toContain('Analysis');
    expect(html).toContain(formatDateTime(first.at));
    expect(html).toContain('autopilot');
    expect(html).toContain('48 s');
    expect(html).toMatch(/data-testid="history-entry-outcome"[^>]*>(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>Ready to sell/);
  });

  it('the newest run is expanded and lists its steps with a word for each status', () => {
    const html = render({ entries: [entry(0), entry(1)] });

    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html.indexOf('aria-expanded="true"')).toBeLessThan(html.indexOf('aria-expanded="false"'));
    expect(html).toContain('Price check');
    expect(html).toContain('Done: ');
    expect(html).toContain('Needs a fix: ');
    expect(html).toContain('Not run: ');
    expect(html).toContain('Only one photo');
  });

  it('opens the newest run, not a suggestion made after it', () => {
    const suggestion = entry(0, { id: 'sug', title: 'Suggestion', startedBy: 'Hermes', durationMs: null, steps: [{ label: 'Shorten the title', status: 'attention', detail: 'Waiting for your review' }] });
    const html = render({ entries: [suggestion, entry(1, { id: 'run' })] });
    const [first, second] = html.split('data-testid="history-entry"').slice(1);

    expect(first).toContain('aria-expanded="false"');
    expect(second).toContain('aria-expanded="true"');
    expect(first).toContain('Needs you: ');
    expect(html).not.toContain('Not run: Shorten');
  });

  it('a running step reads Running and a finished one never does', () => {
    const html = render({
      entries: [
        entry(0, {
          durationMs: null,
          outcome: { label: 'Running', tone: 'info' },
          steps: [{ label: 'Same model used', status: 'running', detail: 'Running' }],
        }),
      ],
    });

    expect(html).toContain('Running: ');
    expect(html).toContain('role="progressbar"');
    const finished = render({ entries: [entry(0, { steps: [{ label: 'Same model used', status: 'none', detail: 'Running' }] })] });
    expect(finished).toContain('Not run: ');
    expect(finished).not.toContain('role="progressbar"');
  });

  it('a running entry shows no duration', () => {
    const html = render({ entries: [entry(0, { durationMs: null, outcome: { label: 'Running', tone: 'info' } })] });

    expect(html).toContain('Running');
    expect(html).not.toMatch(/\d+ s\b|\d+ min/);
  });

  it('a suggestion shows its own text next to the title', () => {
    const html = render({
      entries: [entry(0, { title: 'Suggestion', startedBy: 'Hermes', durationMs: null, steps: [{ label: 'Shorten the title', status: 'none', detail: '' }] })],
    });

    expect(html).toContain('Suggestion · Shorten the title');
  });

  it('an entry without steps is not expandable', () => {
    const html = render({ entries: [entry(0, { steps: [] })] });

    expect(html).toContain('data-testid="history-entry"');
    expect(html).not.toContain('aria-expanded');
  });

  it('no entries renders history-empty', () => {
    const html = render();

    expect(html).toContain('data-testid="history-empty"');
    expect(html).toContain(EMPTY_MESSAGE);
    expect(EMPTY_MESSAGE).toBe('No runs yet. Every analysis and every price search will be listed here with its steps.');
  });

  it('more than 10 entries render 10 and a Show more button', () => {
    const html = render({ entries: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => entry(i)) });

    expect(html.match(/data-testid="history-entry"/g)).toHaveLength(PAGE_SIZE);
    expect(html).toContain('data-testid="history-show-more"');
    expect(render({ entries: Array.from({ length: PAGE_SIZE }, (_, i) => entry(i)) })).not.toContain('history-show-more');
  });

  it('loading and error states replace the list', () => {
    expect(render({ entries: [entry(0)], loading: true })).not.toContain('history-entry');
    const failed = render({ entries: [entry(0)], error: { status: 503 } });
    expect(failed).not.toContain('history-entry');
    expect(failed).not.toContain('history-empty');
    expect(failed).toContain('Try again');
  });
});

describe('formatDuration', () => {
  it('writes seconds, then minutes and seconds', () => {
    expect(formatDuration(48_000)).toBe('48 s');
    expect(formatDuration(130_000)).toBe('2 min 10 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(400)).toBe('1 s');
    expect(formatDuration(0)).toBe('0 s');
  });
});
