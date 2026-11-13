import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const imagePath = 'docs/screenshots/issue-290';
const now = '2026-09-25T10:00:00.000Z';
const user = { id: 'u1', email: 'seller@example.test', workspaceId: 'w1' };
const workspace = {
  id: 'w1', name: 'Demo shop', currency: 'PLN', timezone: 'Europe/Warsaw',
  language: 'en', autonomyLevel: 'suggest_only', createdAt: now, updatedAt: now,
};
const description = 'Mirrorless camera with lens, original battery and carrying bag. Fully working, with minor signs of use.';
const product = {
  id: 'p1', workspaceId: 'w1', sku: 'CAM-001', name: 'Mirrorless camera kit', description,
  costPrice: 650, sellingPrice: 1050, condition: 'good', category: 'Electronics',
  status: 'draft', tags: ['camera', 'photography'], images: [],
  createdAt: now, updatedAt: now,
};
const marketplace = {
  id: 'm1', workspaceId: 'w1', key: 'olx', name: 'OLX', connected: true,
  syncMode: 'manual', errorCount: 0, capacity: 100, createdAt: now,
};
const providerCategory = {
  providerCategoryId: '123', name: 'Cameras', path: ['Electronics', 'Cameras'],
  source: 'user_confirmed', confidence: 1, isLeaf: true,
  taxonomyVerifiedAt: now, taxonomyStaleAt: '2026-10-02T10:00:00.000Z',
};
const draftListing = {
  id: 'l1', productId: 'p1', productName: product.name,
  marketplaceId: 'm1', price: 1050, status: 'draft',
  views: 12, watchers: 1, conversations: 0, messages: 0,
  createdAt: now, updatedAt: now,
};
const categorisedListing = { ...draftListing, marketplaceCategory: providerCategory };
const photoBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const photoUrl = `data:image/png;base64,${photoBase64}`;
const chosenCategory = { providerCategoryId: '123', name: 'Cameras', path: ['Electronics', 'Cameras'] };

type PreviewKind = 'ready' | 'quota';

interface MockOptions {
  // The product's OLX listings before the journey runs.
  listings?: unknown[];
  preview?: PreviewKind;
}

interface ApiLog {
  // Every request that is not a GET, in the order the app sent it.
  writes: string[];
  bodies: Map<string, unknown>;
}

function previewFor(kind: PreviewKind) {
  return {
    dryRun: true, canPublish: kind === 'ready',
    quotaOverrideEligibility: kind === 'ready'
      ? { eligible: false, reason: null }
      : { eligible: true, reason: 'OLX free-publication quota could not be confirmed.' },
    listingId: 'l1', status: 'draft', marketplaceKey: 'olx',
    payload: { productName: product.name, description,
      price: draftListing.price, currency: 'PLN', category: product.category,
      marketplaceCategory: providerCategory, condition: product.condition, imageCount: 1 },
    warnings: kind === 'ready' ? [] : ['OLX free-publication quota could not be confirmed.'],
    marketplaceCategory: providerCategory,
  };
}

async function mockApi(page: Page, options: MockOptions = {}): Promise<ApiLog> {
  const log: ApiLog = { writes: [], bodies: new Map() };
  let listings = options.listings ?? [];
  await page.addInitScript(() => {
    localStorage.setItem('marketdesk.token', 'visual-test-token');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method !== 'GET') {
      log.writes.push(`${method} ${path}`);
      const json = request.headers()['content-type']?.includes('application/json');
      log.bodies.set(`${method} ${path}`, json ? request.postDataJSON() : null);
    }
    let data: unknown;
    let pagination = false;
    if (path === '/api/auth/me') data = user;
    else if (path === '/api/workspaces/w1') data = workspace;
    else if (path === '/api/products' && method === 'GET') {
      data = [product]; pagination = true;
    } else if (path === '/api/products' && method === 'POST') data = product;
    else if (path === '/api/uploads/images' && method === 'POST') data = {
      id: 'img1', url: photoUrl, mediaType: 'image/png', size: 68,
    };
    else if (path === '/api/products/p1') data = product;
    else if (path === '/api/products/p1/listings' && method === 'GET') data = listings;
    else if (path === '/api/products/p1/listings' && method === 'POST') {
      listings = [draftListing];
      data = draftListing;
    } else if (path === '/api/listings/l1/marketplace-category' && method === 'PUT') {
      listings = [categorisedListing];
      data = categorisedListing;
    } else if (path === '/api/products/p1/improvements') data = {
      graphVersion: 'product-assistance@1', productId: 'p1',
      productUpdatedAt: now, listingUpdatedAt: now, reviewOnly: true,
      copy: [{ field: 'description', proposedValue: 'Mirrorless camera kit with lens, original battery and carrying bag. Fully working with minor signs of use.',
        rationale: 'Makes the included accessories and condition easier to scan.' }],
      price: { suggestedPrice: 990, reasoning: 'A small reduction may attract more buyers while staying above cost.', confidence: 'medium' },
    };
    else if (path === '/api/listings/l1/publish-preview') data = previewFor(options.preview ?? 'ready');
    else if (path === '/api/listings/l1/publish' && method === 'POST') {
      listings = [{ ...categorisedListing, isRemotePending: true }];
      data = listings[0];
    } else if (path === '/api/marketplaces') data = [marketplace];
    else if (path === '/api/marketplaces/m1/check') data = {
      connected: true, marketplaceId: 'm1', providerKey: 'olx', status: 'connected',
    };
    else if (path === '/api/marketplaces/m1/categories') data = [chosenCategory];
    else if (path === '/api/hermes/events') { data = []; pagination = true; }
    else if (path === '/api/hermes/status') data = {
      mode: 'offline', activeProvider: 'offline', hermesConfigured: false,
      hermesReachable: null, checkedAt: now,
    };
    else if (path === '/api/settings/preferences') data = { themeMode: 'light' };
    else if (path === '/api/settings/hermes') data = {
      agents: { listingSeo: { enabled: true } }, guardrails: {},
    };
    else if (path === '/api/listings/l1/price-history') data = [];
    else if (path === '/api/application-info') data = { version: '0.19.2' };
    else throw new Error(`Unexpected API request in visual test: ${method} ${path}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data,
        ...(pagination ? { pagination: { page: 1, limit: 20, total: Array.isArray(data) ? data.length : 0, totalPages: 1 } } : {}),
      }),
    });
  });
  return log;
}

// A version 2 wizard draft on the review screen with a photo and a chosen category.
async function seedReviewDraft(page: Page) {
  await page.addInitScript(({ image, category, text }) => {
    localStorage.setItem('marketdesk.productWizardDraft.v2.w1.u1', JSON.stringify({
      version: 2, updatedAt: Date.now(), activeStep: 1, targetMarketplace: 'olx',
      olxCategory: category, createdProductId: null,
      values: {
        name: 'Mirrorless camera kit', sku: '', description: text,
        costPrice: null, sellingPrice: 1050, condition: 'good', category: '',
        status: 'draft', tags: [], images: [image],
      },
    }));
  }, { image: photoUrl, category: chosenCategory, text: description });
}

const publishButton = (page: Page) => page.getByRole('button', { name: 'Publish to OLX' });

test('creates and queues an advert from photos and review without a second dialog', async ({ page }) => {
  // Seller actions, counted: 1 New product, 2 open picker, 3 select photos, 4 Continue,
  // 5 name, 6 description, 7 price, 8 category search, 9 pick category, 10 Publish to OLX.
  const log = await mockApi(page);

  await page.goto('/products');
  await expect(page.getByText('Mirrorless camera kit').first()).toBeVisible();
  await page.getByRole('button', { name: 'New product' }).click();
  const dialog = page.getByRole('dialog');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Upload product photos' }).click(),
  ]);
  await chooser.setFiles({ name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photoBase64, 'base64') });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('heading', { name: 'Review and publish' })).toBeVisible();

  await dialog.getByLabel('Name').fill('Mirrorless camera kit');
  await dialog.getByLabel('Description').fill(description);
  await dialog.getByLabel('Selling price').fill('1050');
  await dialog.getByLabel('OLX category').fill('camera');
  await dialog.getByRole('button', { name: 'Electronics > Cameras' }).click();
  await expect(publishButton(page)).toBeEnabled();
  await dialog.screenshot({ path: `${imagePath}/01-create-product.png`, animations: 'disabled' });
  await publishButton(page).click();

  await expect(page).toHaveURL(/\/products\/p1$/);
  await expect(page.getByText('Publication was accepted and queued.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(log.writes).toEqual([
    'POST /api/uploads/images',
    'POST /api/products',
    'POST /api/products/p1/listings',
    'PUT /api/listings/l1/marketplace-category',
    'POST /api/listings/l1/publish-preview',
    'POST /api/listings/l1/publish',
  ]);
  const created = log.bodies.get('POST /api/products') as { sku?: string };
  expect(created.sku ?? '').toBe('');
  expect(log.bodies.get('PUT /api/listings/l1/marketplace-category')).toEqual({ providerCategoryId: '123' });
  expect(log.bodies.get('POST /api/listings/l1/publish')).not.toHaveProperty('quotaOverride');
});

test('opens the publication review when the preview needs a quota confirmation', async ({ page }) => {
  const log = await mockApi(page, { preview: 'quota' });
  await seedReviewDraft(page);

  await page.goto('/products?newProduct=1');
  await publishButton(page).click();

  await expect(page).toHaveURL(/\/products\/p1$/);
  await expect(page.getByRole('dialog').getByText('Confirm possible OLX fee')).toBeVisible();
  expect(log.writes).not.toContain('POST /api/listings/l1/publish');
});

test('sends one product when Publish to OLX is pressed twice quickly', async ({ page }) => {
  const log = await mockApi(page);
  await seedReviewDraft(page);

  await page.goto('/products?newProduct=1');
  await expect(publishButton(page)).toBeEnabled();
  await publishButton(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.getByText('Publication was accepted and queued.')).toBeVisible();
  expect(log.writes.filter((write) => write === 'POST /api/products')).toHaveLength(1);
});

test('keeps Publish to OLX disabled without a price or while the category changes', async ({ page }) => {
  await mockApi(page);
  await seedReviewDraft(page);

  await page.goto('/products?newProduct=1');
  const dialog = page.getByRole('dialog');
  await expect(publishButton(page)).toBeEnabled();

  await dialog.getByLabel('Selling price').fill('0');
  await expect(publishButton(page)).toBeDisabled();
  await expect(dialog.getByText('Add a price above 0.')).toBeVisible();

  await dialog.getByLabel('Selling price').fill('1050');
  await expect(publishButton(page)).toBeEnabled();
  await dialog.getByRole('button', { name: 'Change' }).click();
  await expect(publishButton(page)).toBeDisabled();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows Publish to OLX on the review screen without scrolling', async ({ page }) => {
    await mockApi(page);
    await seedReviewDraft(page);

    await page.goto('/products?newProduct=1');
    await expect(publishButton(page)).toBeVisible();
    await expect(publishButton(page)).toBeInViewport({ ratio: 1 });
  });
});

test('shows review-only assistance and the manual publication review', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await mockApi(page, { listings: [draftListing] });

  await page.goto('/products/p1');
  await expect(page.getByText('Publication readiness check')).toBeVisible();
  await page.getByRole('button', { name: 'Suggest improvements' }).click();
  await expect(page.getByText('Suggested price: 990 zł')).toBeVisible();
  await expect(page.getByText('Suggestions are for review only.')).toBeVisible();
  await page.locator('.MuiCard-root').filter({
    has: page.getByText('Hermes', { exact: true }),
  }).screenshot({ path: `${imagePath}/02-review-suggestions.png`, animations: 'disabled' });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Confirm publication request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm category and queue publish' })).toBeVisible();
  await page.getByRole('dialog').screenshot({
    path: `${imagePath}/03-confirm-publication.png`, animations: 'disabled',
  });

  expect(consoleErrors.filter((text) => text.includes('does not recognize the'))).toEqual([]);
});
