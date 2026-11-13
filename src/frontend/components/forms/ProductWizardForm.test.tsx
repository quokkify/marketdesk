import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import type { Marketplace } from '@shared/types';
import { lightTheme } from '../../theme/lightTheme';
import { emptyProductValues } from './productFormModel';
import type { WizardOlxCategory } from './productFormModel';
import {
  buildWizardMarketplaceOptions,
  buildWizardSubmission,
  draftBlocker,
  NoMarketplaceConnectedCard,
  photosBlocker,
  ProductWizardForm,
  ProductWizardView,
  publishBlocker,
  resolveTargetMarketplace,
  shouldClearWizardTarget,
  STEPS,
  verifyWizardMarketplaceReadiness,
  wizardMarketplaceStatus,
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

describe('ProductWizardForm marketplace target', () => {
  it('clears a restored target that is not a connected wizard option', () => {
    const allegro = marketplace({ id: 'marketplace-allegro', key: 'allegro', name: 'Allegro' });

    expect(shouldClearWizardTarget('allegro', [marketplace(), allegro])).toBe(true);
    expect(shouldClearWizardTarget('olx', [marketplace({ connected: false })])).toBe(true);
    expect(shouldClearWizardTarget('olx', [marketplace()])).toBe(false);
    expect(shouldClearWizardTarget('olx', undefined)).toBe(false);
    expect(shouldClearWizardTarget(null, [marketplace()])).toBe(false);
  });

  it('targets the single connected option without asking the seller', () => {
    expect(resolveTargetMarketplace([marketplace()])).toBe('olx');
    expect(resolveTargetMarketplace([marketplace({ connected: false })])).toBeNull();
    expect(resolveTargetMarketplace([])).toBeNull();
    expect(resolveTargetMarketplace(undefined)).toBeNull();
    expect(
      resolveTargetMarketplace([marketplace({ id: 'marketplace-allegro', key: 'allegro' })])
    ).toBeNull();
  });

  it('derives the marketplace status from loading, failure and connections', () => {
    expect(wizardMarketplaceStatus(undefined, true, false)).toBe('loading');
    expect(wizardMarketplaceStatus(undefined, false, false)).toBe('loading');
    expect(wizardMarketplaceStatus(undefined, false, true)).toBe('unavailable');
    expect(wizardMarketplaceStatus([marketplace({ connected: false })], false, false)).toBe('none');
    expect(wizardMarketplaceStatus([marketplace()], false, false)).toBe('connected');
  });
});

describe('ProductWizardForm marketplace options', () => {
  it('offers OLX only and ignores other stored marketplaces', () => {
    const options = buildWizardMarketplaceOptions([
      marketplace(),
      marketplace({ id: 'marketplace-allegro', key: 'allegro', name: 'Allegro', connected: true }),
    ]);

    expect(options.map((option) => option.key)).toEqual(['olx']);
    expect(options[0]).toMatchObject({ configured: true, connected: true, integrated: true });
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

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ThemeProvider theme={lightTheme}>{node}</ThemeProvider>
    </MemoryRouter>
  );
}

// The opening tag of the button whose content contains the label, or null.
function buttonTag(html: string, label: string): string | null {
  const pattern = new RegExp(`(<button[^>]*>)((?!</button>).)*${label}((?!</button>).)*</button>`);
  return pattern.exec(html)?.[1] ?? null;
}

const chairs: WizardOlxCategory = {
  providerCategoryId: '123',
  name: 'Fotele',
  path: ['Dom i Ogród', 'Meble', 'Fotele'],
};

function reviewValues() {
  return { ...validValues(), sku: '', category: '' };
}

function view(overrides: Partial<React.ComponentProps<typeof ProductWizardView>> = {}) {
  return render(
    <ProductWizardView
      activeStep={1}
      values={reviewValues()}
      errors={{}}
      serverError={null}
      olxCategory={chairs}
      marketplaceStatus="connected"
      belowCostConfirmed={false}
      belowCostHasError={false}
      submitting={false}
      currency="PLN"
      searchCategories={() => Promise.resolve([])}
      onChange={() => undefined}
      onOlxCategoryChange={() => undefined}
      onBelowCostConfirmedChange={() => undefined}
      onUploadImage={() => Promise.reject(new Error('not used'))}
      onContinue={() => undefined}
      onBack={() => undefined}
      onSaveDraft={() => undefined}
      onPublish={() => undefined}
      {...overrides}
    />
  );
}

describe('ProductWizardForm two screens', () => {
  it('renders two steps', () => {
    expect(STEPS).toEqual(['Photos', 'Review']);
    const photos = view({ activeStep: 0 });
    expect(photos).toContain('Step 1 of 2');
    expect(photos).toContain('Continue');
    expect(photos).toContain('Take or choose photos');
    const review = view();
    expect(review).toContain('Step 2 of 2');
    expect(review).toContain('Review and publish');
  });

  it('disables Continue with no photos and enables it with 1 to 12', () => {
    expect(photosBlocker([])).toBe('Add at least one product photo.');
    expect(photosBlocker(['a.jpg', ' '])).toBe('Remove blank product photos.');
    expect(photosBlocker(Array.from({ length: 13 }, (_, i) => `${i}.jpg`))).toBe(
      'Add no more than 12 product photos.'
    );
    expect(photosBlocker(['a.jpg'])).toBeNull();
    expect(photosBlocker(Array.from({ length: 12 }, (_, i) => `${i}.jpg`))).toBeNull();

    const empty = view({ activeStep: 0, values: { ...reviewValues(), images: [] } });
    expect(buttonTag(empty, 'Continue')).toContain('disabled=""');
    expect(empty).toContain('Add at least one product photo.');
    expect(buttonTag(view({ activeStep: 0 }), 'Continue')).not.toContain('disabled=""');
  });

  it('has no SKU, tags, generic category, marketplace radio or AI draft panel on the review screen', () => {
    const html = view();
    expect(html).not.toContain('SKU');
    expect(html).not.toContain('Tags');
    expect(html).not.toContain('Home and Garden');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('AI-assisted');
    expect(html).not.toContain('Create from photos');
    expect(html).toContain('Name');
    expect(html).toContain('Description');
    expect(html).toContain('Condition');
    expect(html).toContain('Selling price');
    expect(html).toContain('Cost price');
    expect(html).toContain('Dom i Ogród &gt; Meble &gt; Fotele');
    expect(html).toContain('Save as draft');
    expect(buttonTag(html, 'Publish to OLX')).not.toContain('disabled=""');
  });

  it('keeps Publish to OLX disabled at price 0 and names the reason', () => {
    const values = { ...reviewValues(), sellingPrice: 0 };
    expect(
      publishBlocker({
        values,
        olxCategory: chairs,
        marketplaceStatus: 'connected',
        belowCostConfirmed: false,
      })
    ).toBe('Add a price above 0.');
    const html = view({ values });
    expect(buttonTag(html, 'Publish to OLX')).toContain('disabled=""');
    expect(html).toContain('Add a price above 0.');
    expect(buttonTag(html, 'Save as draft')).not.toContain('disabled=""');
  });

  it('asks for an OLX category before publishing', () => {
    expect(
      publishBlocker({
        values: reviewValues(),
        olxCategory: null,
        marketplaceStatus: 'connected',
        belowCostConfirmed: false,
      })
    ).toBe('Choose an OLX category.');
    const html = view({ olxCategory: null });
    expect(buttonTag(html, 'Publish to OLX')).toContain('disabled=""');
    expect(html).toContain('Choose an OLX category.');
  });

  it('waits for marketplace connections, field errors and the below-cost confirmation', () => {
    const ready = {
      values: reviewValues(),
      olxCategory: chairs,
      marketplaceStatus: 'connected' as const,
      belowCostConfirmed: false,
    };
    expect(publishBlocker(ready)).toBeNull();
    expect(publishBlocker({ ...ready, marketplaceStatus: 'loading' })).toBe(
      'Marketplace connections are still loading.'
    );
    expect(publishBlocker({ ...ready, values: { ...reviewValues(), name: ' ' } })).toBe(
      'Name is required.'
    );
    const belowCost = { ...reviewValues(), costPrice: 150 };
    expect(publishBlocker({ ...ready, values: belowCost })).toBe('Confirm the below-cost price.');
    expect(publishBlocker({ ...ready, values: belowCost, belowCostConfirmed: true })).toBeNull();
    expect(view({ marketplaceStatus: 'loading' })).toContain(
      'Marketplace connections are still loading.'
    );
  });

  it('lets a draft through with only the product values valid', () => {
    expect(draftBlocker({ ...reviewValues(), sellingPrice: 0 })).toBeNull();
    expect(draftBlocker({ ...reviewValues(), name: '' })).toBe('Name is required.');
    expect(buttonTag(view({ values: { ...reviewValues(), name: '' } }), 'Save as draft')).toContain(
      'disabled=""'
    );
  });

  it('builds the publish submission with the target, category and derived product category', () => {
    const submission = buildWizardSubmission('publish', reviewValues(), chairs, [marketplace()]);
    expect(submission).toMatchObject({
      intent: 'publish',
      targetMarketplace: 'olx',
      olxCategory: chairs,
    });
    expect(submission.values.category).toBe('Dom i Ogród');
    expect(submission.values.sku).toBe('');
    expect(submission.values).not.toHaveProperty('targetMarketplace');
  });

  it('keeps the category a converted old draft already carries', () => {
    const submission = buildWizardSubmission(
      'publish',
      { ...reviewValues(), sku: 'CAM-001', category: 'Electronics' },
      chairs,
      [marketplace()]
    );
    expect(submission.values.category).toBe('Electronics');
    expect(submission.values.sku).toBe('CAM-001');
  });

  it('offers only Save as draft when no marketplace is connected', () => {
    const html = view({
      marketplaceStatus: 'none',
      olxCategory: null,
      searchCategories: undefined,
    });
    expect(html).not.toContain('Publish to OLX');
    expect(html).toContain('No marketplace connected');
    expect(buttonTag(html, 'Save as draft')).not.toContain('disabled=""');
    const submission = buildWizardSubmission('draft', reviewValues(), null, []);
    expect(submission).toMatchObject({
      intent: 'draft',
      targetMarketplace: null,
      olxCategory: null,
    });
    expect(submission.values.category).toBe('uncategorised');
  });

  it('offers only Save as draft when marketplace connections failed to load', () => {
    const html = view({ marketplaceStatus: 'unavailable', searchCategories: undefined });
    expect(html).not.toContain('Publish to OLX');
    expect(html).toContain('Marketplace connections could not be loaded.');
  });

  it('shows a rejected field on the review screen', () => {
    const html = view({
      errors: { name: 'Name is already used.' },
      serverError: 'Invalid product.',
    });
    expect(html).toContain('Name is already used.');
    expect(html).toContain('The product was not created: Invalid product');
  });

  it('disables both buttons while submitting', () => {
    const html = view({ submitting: true });
    expect(buttonTag(html, 'Publish to OLX')).toContain('disabled=""');
    expect(buttonTag(html, 'Save as draft')).toContain('disabled=""');
  });

  it('opens a restored draft on the review screen with the publish button', () => {
    const html = render(
      <ProductWizardForm
        initialDraft={{
          values: reviewValues(),
          activeStep: 1,
          targetMarketplace: 'olx',
          olxCategory: chairs,
          createdProductId: null,
        }}
        marketplaces={[marketplace()]}
        currency="PLN"
        searchCategories={() => Promise.resolve([])}
        onSubmit={() => undefined}
        onUploadImage={() => Promise.reject(new Error('not used'))}
      />
    );
    expect(html).toContain('Step 2 of 2');
    expect(buttonTag(html, 'Publish to OLX')).not.toContain('disabled=""');
  });
});

describe('ProductWizardForm no marketplace card', () => {
  it('explains the draft path and links to the OLX connection screen', () => {
    const html = render(<NoMarketplaceConnectedCard />);

    expect(html).toContain('No marketplace connected');
    expect(html).toContain('Save as draft');
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

  it('ignores a stored non-OLX row when verifying readiness', async () => {
    const olx = marketplace({ connected: false });
    const allegro = marketplace({ id: 'marketplace-allegro', key: 'allegro', connected: true });
    const check = jest.fn(async () => {
      throw new Error('only OLX can be checked');
    });

    const result = await verifyWizardMarketplaceReadiness([olx, allegro], check);

    expect(check).not.toHaveBeenCalled();
    expect(result.hadCheckError).toBe(false);
    expect(result.marketplaces).toEqual([{ ...olx, connected: false }]);
  });

  it('reports a failed OLX check even when a non-OLX row is stored as connected', async () => {
    const olx = marketplace();
    const allegro = marketplace({ id: 'marketplace-allegro', key: 'allegro', connected: true });
    const check = jest.fn(async () => {
      throw new Error('credentials cannot be decrypted');
    });

    const result = await verifyWizardMarketplaceReadiness([olx, allegro], check);

    expect(result.hadCheckError).toBe(true);
    expect(result.marketplaces.map((item) => item.key)).toEqual(['olx']);
    expect(result.marketplaces.some((item) => item.connected)).toBe(false);
  });
});
