import { expect, test } from '@playwright/test';

const imagePath = 'docs/screenshots/issue-290';
const now = '2026-09-25T10:00:00.000Z';
const user = { id: 'u1', email: 'seller@example.test', workspaceId: 'w1' };
const workspace = {
  id: 'w1', name: 'Demo shop', currency: 'PLN', timezone: 'Europe/Warsaw',
  language: 'en', autonomyLevel: 'suggest_only', createdAt: now, updatedAt: now,
};
const product = {
  id: 'p1', workspaceId: 'w1', sku: 'CAM-001', name: 'Mirrorless camera kit',
  description: 'Mirrorless camera with lens, original battery and carrying bag. Fully working, with minor signs of use.',
  costPrice: 650, sellingPrice: 1050, condition: 'good', category: 'Electronics',
  status: 'draft', tags: ['camera', 'photography'], images: [],
  createdAt: now, updatedAt: now,
};
const marketplace = {
  id: 'm1', workspaceId: 'w1', key: 'olx', name: 'OLX', connected: true,
  syncMode: 'manual', errorCount: 0, capacity: 100, createdAt: now,
};
const listing = {
  id: 'l1', productId: 'p1', productName: product.name,
  marketplaceId: 'm1', price: 1050, status: 'draft',
  views: 12, watchers: 1, conversations: 0, messages: 0,
  createdAt: now, updatedAt: now,
};
const providerCategory = {
  providerCategoryId: '123', name: 'Cameras', path: ['Electronics', 'Cameras'],
  source: 'user_confirmed', confidence: 1, isLeaf: true,
  taxonomyVerifiedAt: now, taxonomyStaleAt: '2026-10-02T10:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('marketdesk.token', 'visual-test-token');
    localStorage.setItem('marketdesk.productWizardDraft.v1.w1.u1', JSON.stringify({
      version: 1, updatedAt: Date.now(), activeStep: 5, targetMarketplace: 'olx',
      values: {
        name: 'Mirrorless camera kit', sku: 'CAM-001',
        description: 'Mirrorless camera with lens, original battery and carrying bag. Fully working, with minor signs of use.',
        costPrice: 650, sellingPrice: 1050, condition: 'good', category: 'Electronics',
        status: 'draft', tags: ['camera', 'photography'], images: ['demo-camera-photo'],
      },
    }));
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data: unknown;
    let pagination = false;
    if (path === '/api/auth/me') data = user;
    else if (path === '/api/workspaces/w1') data = workspace;
    else if (path === '/api/products' && request.method() === 'GET') {
      data = [product]; pagination = true;
    } else if (path === '/api/products/p1') data = product;
    else if (path === '/api/products/p1/listings') data = [listing];
    else if (path === '/api/products/p1/improvements') data = {
      graphVersion: 'product-assistance@1', productId: 'p1',
      productUpdatedAt: now, listingUpdatedAt: now, reviewOnly: true,
      copy: [{ field: 'description', proposedValue: 'Mirrorless camera kit with lens, original battery and carrying bag. Fully working with minor signs of use.',
        rationale: 'Makes the included accessories and condition easier to scan.' }],
      price: { suggestedPrice: 990, reasoning: 'A small reduction may attract more buyers while staying above cost.', confidence: 'medium' },
    };
    else if (path === '/api/listings/l1/publish-preview') data = {
      dryRun: true, canPublish: true,
      quotaOverrideEligibility: { eligible: false, reason: null },
      listingId: 'l1', status: 'draft', marketplaceKey: 'olx',
      payload: { productName: product.name, description: product.description,
        price: listing.price, currency: 'PLN', category: product.category,
        marketplaceCategory: providerCategory, condition: product.condition, imageCount: 1 },
      warnings: [], marketplaceCategory: providerCategory,
    };
    else if (path === '/api/marketplaces') data = [marketplace];
    else if (path === '/api/marketplaces/m1/check') data = {
      connected: true, marketplaceId: 'm1', providerKey: 'olx', status: 'connected',
    };
    else if (path === '/api/hermes/events') { data = []; pagination = true; }
    else if (path === '/api/settings/preferences') data = { themeMode: 'light' };
    else if (path === '/api/settings/hermes') data = {
      agents: { listingSeo: { enabled: true } }, guardrails: {},
    };
    else if (path === '/api/listings/l1/price-history') data = [];
    else if (path === '/api/application-info') data = { version: '0.19.2' };
    else throw new Error(`Unexpected API request in visual test: ${request.method()} ${path}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data,
        ...(pagination ? { pagination: { page: 1, limit: 20, total: Array.isArray(data) ? data.length : 0, totalPages: 1 } } : {}),
      }),
    });
  });
});

test('shows the product creation entry point and review-only assistance', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByText('Mirrorless camera kit').first()).toBeVisible();
  await page.getByRole('button', { name: 'New product' }).click();
  await expect(page.getByText('Creating saves the product and opens a marketplace listing draft for review.')).toBeVisible();
  await page.getByRole('dialog').screenshot({
    path: `${imagePath}/01-create-product.png`, animations: 'disabled',
  });

  await page.goto('/products/p1');
  await expect(page.getByText('Publication readiness check')).toBeVisible();
  await page.getByRole('button', { name: 'Suggest improvements' }).click();
  await expect(page.getByText('Suggested price: 990 PLN')).toBeVisible();
  await expect(page.getByText('Suggestions are for review only.')).toBeVisible();
  await page.locator('.MuiCard-root').filter({
    has: page.getByText('Product assistant', { exact: true }),
  }).screenshot({ path: `${imagePath}/02-review-suggestions.png`, animations: 'disabled' });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Confirm publication request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm category and queue publish' })).toBeVisible();
  await page.getByRole('dialog').screenshot({
    path: `${imagePath}/03-confirm-publication.png`, animations: 'disabled',
  });
});
