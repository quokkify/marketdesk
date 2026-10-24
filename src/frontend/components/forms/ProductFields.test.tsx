import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme } from '../../theme/lightTheme';
import { emptyProductValues } from './productFormModel';
import { DescriptionTagsFields, NameSkuFields, PriceFields } from './ProductFields';

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>);
}

describe('ProductFields server-reported errors', () => {
  it('shows condition and tag errors next to their controls', () => {
    const errors = { condition: 'Choose a valid condition.', tags: 'Tags cannot be empty.' };
    const html = render(
      <>
        <NameSkuFields values={emptyProductValues()} errors={errors} onChange={() => undefined} />
        <DescriptionTagsFields
          values={emptyProductValues()}
          errors={errors}
          onChange={() => undefined}
        />
      </>
    );

    expect(html).toContain('Choose a valid condition.');
    expect(html).toContain('Tags cannot be empty.');
  });
});

describe('PriceFields', () => {
  it('marks the cost as optional and shows the workspace currency', () => {
    const html = render(
      <PriceFields
        values={{ ...emptyProductValues(), costPrice: null }}
        errors={{}}
        onChange={() => undefined}
        currency="PLN"
      />
    );

    expect(html).toContain('Leave empty if the cost is unknown.');
    expect(html).toContain('zł');
  });
});
