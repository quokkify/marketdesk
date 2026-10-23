import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import type { Marketplace } from '@shared/types';
import { lightTheme } from '../../theme/lightTheme';
import { emptyProductValues } from './productFormModel';
import {
  buildWizardMarketplaceOptions,
  firstWizardStepWithErrors,
  NoMarketplaceConnectedCard,
  validateWizardStep,
  verifyWizardMarketplaceReadiness,
  WizardReviewSummary,
} from './ProductWizardForm';

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'workspace-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'manual',
    errorCount: 0,
    capacity: 100,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'Camera',
    sku: 'CAM-1',
    description: 'Camera in good condition with all required product details.',
    sellingPrice: 100,
    category: 'Electronics',
    images: ['https://example.com/camera.jpg'],
  };
}

describe('ProductWizardForm required-step validation', () => {
  it('requires at least one photo before leaving Photos', () => {
    const result = validateWizardStep(0, { ...validValues(), images: [] }, null, [marketplace()]);

    expect(result.fieldErrors.images).toBe('Add at least one product photo.');
  });

  it('rejects blank photo values and more than twelve photos', () => {
    expect(
      validateWizardStep(0, { ...validValues(), images: ['  '] }, null, [marketplace()]).fieldErrors
        .images
    ).toBe('Remove blank product photos.');
    expect(
      validateWizardStep(
        0,
        { ...validValues(), images: ['https://example.com/valid.jpg', ' '] },
        null,
        [marketplace()]
      ).fieldErrors.images
    ).toBe('Remove blank product photos.');
    expect(
      validateWizardStep(
        0,
        {
          ...validValues(),
          images: Array.from({ length: 13 }, (_, index) => `https://example.com/${index}.jpg`),
        },
        null,
        [marketplace()]
      ).fieldErrors.images
    ).toBe('Add no more than 12 product photos.');
  });

  it('requires a category before leaving Category', () => {
    const result = validateWizardStep(3, { ...validValues(), category: '  ' }, null, [
      marketplace(),
    ]);

    expect(result.fieldErrors.category).toBe('Choose a category.');
  });

  it('blocks Marketplace while connections are loading or unavailable', () => {
    expect(validateWizardStep(4, validValues(), null, undefined, true).marketplaceError).toContain(
      'load'
    );
    expect(
      validateWizardStep(4, validValues(), null, undefined, false, true).marketplaceError
    ).toContain('could not be loaded');
  });

  it('treats a not-yet-loaded marketplace list as loading, not as no connection', () => {
    expect(validateWizardStep(4, validValues(), null, undefined).marketplaceError).toBe(
      'Wait for marketplace connections to load.'
    );
  });

  it('lets the product continue as a draft when no marketplace is connected', () => {
    expect(validateWizardStep(4, validValues(), null, [marketplace({ connected: false })])).toEqual(
      { fieldErrors: {} }
    );
    expect(validateWizardStep(4, validValues(), null, [])).toEqual({ fieldErrors: {} });
  });

  it('requires an explicit selection once a marketplace is connected', () => {
    const connected = marketplace();

    expect(validateWizardStep(4, validValues(), null, [connected]).marketplaceError).toBe(
      'Select a connected marketplace.'
    );
    expect(validateWizardStep(4, validValues(), 'allegro', [connected]).marketplaceError).toBe(
      'Select a connected marketplace.'
    );
    expect(validateWizardStep(4, validValues(), 'olx', [connected])).toEqual({ fieldErrors: {} });
  });
});

describe('ProductWizardForm marketplace options', () => {
  it('enables only connections reported as connected by the API', () => {
    const options = buildWizardMarketplaceOptions([
      marketplace(),
      marketplace({
        id: 'marketplace-allegro',
        key: 'allegro',
        name: 'Allegro',
        connected: false,
      }),
    ]);

    expect(options).toHaveLength(7);
    expect(options.find((option) => option.key === 'olx')).toMatchObject({
      configured: true,
      connected: true,
    });
    expect(options.find((option) => option.key === 'allegro')).toMatchObject({
      configured: true,
      connected: false,
    });
    expect(options.find((option) => option.key === 'ebay')).toMatchObject({
      configured: false,
      connected: false,
      integrated: false,
    });
  });

  it('marks OLX as the integrated channel and carries the sandbox flag', () => {
    const options = buildWizardMarketplaceOptions([
      { ...marketplace(), sandbox: true } as Marketplace,
    ]);

    expect(options.find((option) => option.key === 'olx')).toMatchObject({
      integrated: true,
      sandbox: true,
    });
    expect(
      buildWizardMarketplaceOptions([marketplace()]).find((option) => option.key === 'olx')
    ).toMatchObject({ sandbox: false });
  });
});

describe('ProductWizardForm server validation errors', () => {
  it('jumps to the first wizard step that owns a rejected field', () => {
    expect(firstWizardStepWithErrors({ images: 'Too many photos' })).toBe(0);
    expect(firstWizardStepWithErrors({ costPrice: 'Required', sku: 'Taken' })).toBe(1);
    expect(firstWizardStepWithErrors({ condition: 'Invalid' })).toBe(1);
    expect(firstWizardStepWithErrors({ sellingPrice: 'Below cost' })).toBe(2);
    expect(firstWizardStepWithErrors({ category: 'Required' })).toBe(3);
    expect(firstWizardStepWithErrors({})).toBeNull();
  });
});

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ThemeProvider theme={lightTheme}>{node}</ThemeProvider>
    </MemoryRouter>
  );
}

function reviewValues() {
  return {
    ...validValues(),
    name: 'Mirrorless camera kit',
    description:
      'Compact mirrorless camera with a 16-50mm kit lens, two batteries and a charger. Lightly used, excellent condition, original box included and ready to ship the same day.',
    condition: 'like_new' as const,
    costPrice: 800,
    sellingPrice: 1050,
    images: ['https://example.com/camera.jpg', 'https://example.com/back.jpg'],
  };
}

describe('ProductWizardForm review step', () => {
  it('wizard review step shows formatted price and marketplace', () => {
    const [olx] = buildWizardMarketplaceOptions([marketplace()]);
    const html = render(<WizardReviewSummary values={reviewValues()} currency="PLN" marketplace={olx!} />);

    expect(html).toContain('Mirrorless camera kit');
    expect(html).toContain('src="https://example.com/camera.jpg"');
    expect(html).toContain('Like new');
    expect(html).toContain('Electronics');
    expect(html).toContain('Compact mirrorless camera with a 16-50mm kit lens');
    expect(html).toContain('…');
    expect(html).not.toContain('ready to ship the same day');
    expect(html).toContain('1 050 zł');
    expect(html).toContain('250 zł');
    expect(html).toContain('24% margin');
    expect(html).toContain('OLX');
    expect(html).not.toContain('Sandbox');
  });

  it('states that the product is saved as a draft when no marketplace is selected', () => {
    const html = render(
      <WizardReviewSummary values={{ ...reviewValues(), costPrice: null }} currency="PLN" marketplace={null} />
    );

    expect(html).toContain('Saved as a draft');
    expect(html).toContain('Cost unknown');
    expect(html).not.toContain('% margin');
  });

  it('labels a sandbox OLX target', () => {
    const [olx] = buildWizardMarketplaceOptions([{ ...marketplace(), sandbox: true } as Marketplace]);
    const html = render(<WizardReviewSummary values={reviewValues()} currency="PLN" marketplace={olx!} />);

    expect(html).toContain('Sandbox');
  });
});

describe('ProductWizardForm no marketplace card', () => {
  it('explains the draft path and links to the OLX connection screen', () => {
    const html = render(<NoMarketplaceConnectedCard />);

    expect(html).toContain('No marketplace connected');
    expect(html).toContain('Create as draft');
    expect(html).toContain('href="/marketplaces"');
    expect(html).toContain('Connect OLX');
  });
});

describe('ProductWizardForm authoritative marketplace readiness', () => {
  it('enables a local connection only after a matching authoritative check', async () => {
    const connected = marketplace();
    const check = jest.fn(async (id: string) => ({
      connected: true,
      marketplaceId: id,
      providerKey: 'olx' as const,
    }));

    const result = await verifyWizardMarketplaceReadiness([connected], check);

    expect(check).toHaveBeenCalledWith('marketplace-olx');
    expect(result).toEqual({ marketplaces: [connected], hadCheckError: false });
  });

  it('fails closed for identity mismatch, check failure, and local disconnection', async () => {
    const disconnected = marketplace({ id: 'marketplace-offline', connected: false });
    const mismatch = marketplace({ id: 'marketplace-mismatch' });
    const failed = marketplace({ id: 'marketplace-failed' });
    const check = jest.fn(async (id: string) => {
      if (id === failed.id) throw new Error('credentials cannot be decrypted');
      return { connected: true, marketplaceId: 'other-id', providerKey: 'olx' as const };
    });

    const result = await verifyWizardMarketplaceReadiness([disconnected, mismatch, failed], check);

    expect(check).toHaveBeenCalledTimes(2);
    expect(result.marketplaces.every((item) => !item.connected)).toBe(true);
    expect(result.hadCheckError).toBe(true);
  });
});
