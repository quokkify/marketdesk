import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import type { OlxCategorySearchState } from './olxCategorySearch';
import { OlxCategoryPickerView } from './OlxCategoryPicker';

const path = ['Dom i Ogród', 'Meble', 'Fotele'];
const idle: OlxCategorySearchState = { query: '', status: 'idle', results: [] };

function render(props: Partial<React.ComponentProps<typeof OlxCategoryPickerView>>) {
  return renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <OlxCategoryPickerView
        value={null}
        state={idle}
        onQueryChange={() => undefined}
        onPick={() => undefined}
        onChangeRequested={() => undefined}
        {...props}
      />
    </ThemeProvider>
  );
}

describe('OlxCategoryPickerView', () => {
  it('shows the chosen path and a Change button', () => {
    const html = render({ value: { providerCategoryId: '1', name: 'Fotele', path } });
    expect(html).toContain('Dom i Ogród &gt; Meble &gt; Fotele');
    expect(html).toContain('Change');
  });

  it('shows the searching indicator', () => {
    const html = render({ state: { query: 'fot', status: 'searching', results: [] } });
    expect(html).toContain('Searching OLX categories…');
  });

  it('shows the empty answer text', () => {
    const html = render({ state: { query: 'zzz', status: 'empty', results: [] } });
    expect(html).toContain('No matching OLX categories. Try a shorter or different word.');
  });

  it('shows the unavailable text', () => {
    const html = render({ state: { query: 'fot', status: 'unavailable', results: [] } });
    expect(html).toContain(
      'OLX category search is unavailable right now. You can save the product as a draft.'
    );
  });

  it('lists each result as its full path', () => {
    const html = render({
      state: {
        query: 'fot',
        status: 'results',
        results: [
          { providerCategoryId: '1', name: 'Fotele', path },
          { providerCategoryId: '2', name: 'Fotele ogrodowe', path: ['Dom i Ogród', 'Ogród'] },
        ],
      },
    });
    expect(html).toContain('Dom i Ogród &gt; Meble &gt; Fotele');
    expect(html).toContain('Dom i Ogród &gt; Ogród');
  });

  it('renders the error prop', () => {
    expect(render({ error: 'Choose an OLX category.' })).toContain('Choose an OLX category.');
  });

  it('offers Cancel while changing an existing category', () => {
    const html = render({ onCancelChange: () => undefined });
    expect(html).toContain('OLX category');
    expect(html).toContain('Cancel');
  });

  it('offers no Cancel when no category was chosen yet', () => {
    expect(render({})).not.toContain('Cancel');
  });
});
