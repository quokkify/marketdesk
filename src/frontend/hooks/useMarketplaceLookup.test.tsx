import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useMarketplaceLookup } from './useMarketplaceLookup';

const mockUseMarketplaces = jest.fn();

jest.mock('../services/hooks/index.js', () => ({
  useMarketplaces: () => mockUseMarketplaces(),
}));

function lookup(): ReturnType<typeof useMarketplaceLookup> {
  let captured: ReturnType<typeof useMarketplaceLookup> | undefined;
  const Probe = () => {
    captured = useMarketplaceLookup();
    return null;
  };
  renderToStaticMarkup(<Probe />);
  if (!captured) throw new Error('useMarketplaceLookup was not called');
  return captured;
}

describe('useMarketplaceLookup', () => {
  it('resolves the sandbox flag of each marketplace id', () => {
    mockUseMarketplaces.mockReturnValue({
      data: [
        { id: 'marketplace-sandbox', key: 'olx', name: 'OLX', sandbox: true },
        { id: 'marketplace-real', key: 'olx', name: 'OLX', sandbox: false },
      ],
    });

    const { resolveMarketplaceSandbox } = lookup();

    expect(resolveMarketplaceSandbox('marketplace-sandbox')).toBe(true);
    expect(resolveMarketplaceSandbox('marketplace-real')).toBe(false);
    expect(resolveMarketplaceSandbox('marketplace-unknown')).toBe(false);
  });
});
