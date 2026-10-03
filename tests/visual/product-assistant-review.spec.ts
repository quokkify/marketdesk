import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ProductImprovementReviewSession } from '../../src/shared/types/index.js';

const now = '2026-09-30T10:00:00.000Z';
async function mockReview(page: Page) {
  const product = {
    id: 'p1',
    workspaceId: 'w1',
    sku: 'CAM-001',
    name: 'Camera kit',
    description: 'Camera with lens',
    costPrice: 650,
    sellingPrice: 1050,
    condition: 'good',
    category: 'Electronics',
    status: 'draft',
    tags: [],
    images: [],
    createdAt: now,
    updatedAt: now,
  };
  const listing = {
    id: 'l1',
    productId: 'p1',
    marketplaceId: 'm1',
    price: 1050,
    status: 'draft',
    views: 0,
    watchers: 0,
    messages: 0,
    createdAt: now,
    updatedAt: now,
  };
  let session: ProductImprovementReviewSession = {
    sessionId: 's1',
    currency: 'PLN',
    graphVersion: 'product-assistance@1',
    revision: 1,
    productId: 'p1',
    listingId: 'l1',
    productUpdatedAt: now,
    listingUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    proposals: [
      {
        proposalId: 'title',
        field: 'title',
        proposedValue: 'Camera kit with lens',
        rationale: 'Adds accessories',
        status: 'pending',
      },
      {
        proposalId: 'description',
        field: 'description',
        proposedValue: 'Camera, lens and battery',
        rationale: 'Clear contents',
        status: 'pending',
      },
      {
        proposalId: 'price',
        field: 'price',
        proposedValue: 990,
        rationale: 'Competitive listing price',
        status: 'pending',
      },
    ],
  };
  const decisions: Record<string, unknown>[] = [];
  const requests: string[] = [];
  let forceConflict = false;
  let restoreFailure = false;
  await page.addInitScript(() => localStorage.setItem('marketdesk.token', 'review-test-token'));
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      requests.push(`${request.method()} ${path}`);
      let data: unknown;
      let pagination = false;
      if (path === '/api/auth/me')
        data = { id: 'u1', email: 'seller@example.test', workspaceId: 'w1' };
      else if (path === '/api/workspaces/w1')
        data = {
          id: 'w1',
          name: 'Shop',
          currency: 'PLN',
          timezone: 'Europe/Warsaw',
          language: 'en',
          autonomyLevel: 'suggest_only',
          createdAt: now,
          updatedAt: now,
        };
      else if (path === '/api/products/p1') data = product;
      else if (path === '/api/products/p1/listings') data = [listing];
      else if (path === '/api/products/p1/improvements' && request.method() === 'GET') {
        expect(url.searchParams.get('listingId')).toBe('l1');
        if (restoreFailure) {
          await route.fulfill({
            status: 500,
            json: { success: false, error: { message: 'Saved review unavailable' } },
          });
          return;
        }
        data = session;
      } else if (path === '/api/products/p1/improvements' && request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ listingId: 'l1' });
        session = {
          ...session,
          sessionId: 's2',
          revision: 1,
          productUpdatedAt: product.updatedAt,
          listingUpdatedAt: listing.updatedAt,
          updatedAt: '2026-09-30T12:00:00.000Z',
          proposals: session.proposals.map((proposal) => ({
            ...proposal,
            status: 'pending',
            decidedAt: undefined,
            editedValue: undefined,
          })),
        };
        data = {
          productId: 'p1',
          productUpdatedAt: product.updatedAt,
          listingUpdatedAt: listing.updatedAt,
          graphVersion: 'product-assistance@1',
          reviewOnly: true,
          copy: [],
          price: null,
          session,
        };
      } else if (path.match(/\/improvements\/s[12]\/decisions$/)) {
        expect(url.searchParams.get('listingId')).toBe('l1');
        const body = request.postDataJSON();
        decisions.push(body);
        if (forceConflict) {
          await route.fulfill({
            status: 409,
            json: { success: false, error: { message: 'Review changed' } },
          });
          return;
        }
        expect(body.revision).toBe(session.revision);
        const proposal = session.proposals.find((p) => p.proposalId === body.proposalId)!;
        if (body.action === 'accept') {
          if (proposal.field === 'title') product.name = body.editedValue;
          else if (proposal.field === 'description') product.description = body.editedValue;
          else listing.price = body.editedValue;
          if (proposal.field === 'price')
            listing.updatedAt = `2026-09-30T11:00:0${session.revision}.000Z`;
          else product.updatedAt = `2026-09-30T11:00:0${session.revision}.000Z`;
        }
        session = {
          ...session,
          revision: session.revision + 1,
          productUpdatedAt: product.updatedAt,
          listingUpdatedAt: listing.updatedAt,
          updatedAt: `2026-09-30T11:00:0${session.revision}.000Z`,
          proposals: session.proposals.map((p) =>
            p.proposalId === body.proposalId
              ? {
                  ...p,
                  status: body.action === 'accept' ? 'accepted' : 'rejected',
                  ...(body.editedValue !== undefined ? { editedValue: body.editedValue } : {}),
                }
              : p
          ),
        };
        data = session;
      } else if (path === '/api/marketplaces')
        data = [
          {
            id: 'm1',
            workspaceId: 'w1',
            key: 'olx',
            name: 'OLX',
            connected: true,
            syncMode: 'manual',
            errorCount: 0,
            capacity: 100,
            createdAt: now,
          },
        ];
      else if (path === '/api/hermes/events') {
        data = [];
        pagination = true;
      } else if (path === '/api/settings/preferences') data = { themeMode: 'light' };
      else if (path === '/api/settings/hermes')
        data = { agents: { listingSeo: { enabled: true } }, guardrails: {} };
      else if (path === '/api/listings/l1/price-history') data = [];
      else if (path === '/api/application-info') data = { version: '0.19.2' };
      else throw new Error(`Unexpected request: ${request.method()} ${path}`);
      await route.fulfill({
        status: 200,
        json: {
          success: true,
          data,
          ...(pagination ? { pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } : {}),
        },
      });
    }
  );
  return {
    decisions,
    requests,
    product,
    listing,
    conflict: () => {
      forceConflict = true;
    },
    failRestore: (fail: boolean) => {
      restoreFailure = fail;
    },
  };
}
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`restores and reviews saved suggestions at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const server = await mockReview(page);
    await page.goto('/products/p1');
    await expect(page.getByText('Title · Pending review')).toBeVisible();
    const assistant = page
      .locator('.MuiCard-root')
      .filter({ has: page.getByText('Product assistant', { exact: true }) });
    await expect(assistant.getByText('Product assistant', { exact: true })).toBeVisible();
    expect(
      await assistant
        .getByText('Product assistant', { exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.reload();
    await expect(page.getByText('Title · Pending review')).toBeVisible();
    await page.getByRole('button', { name: 'Review title', exact: true }).click();
    await page.getByRole('textbox', { name: 'Proposed value' }).fill('Camera with original lens');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('Title · Accepted')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Camera with original lens', exact: true })
    ).toBeVisible();
    expect(server.decisions[0]).toEqual({
      revision: 1,
      proposalId: 'title',
      action: 'accept',
      editedValue: 'Camera with original lens',
    });
    await page.getByRole('button', { name: 'Reject description', exact: true }).click();
    await expect(page.getByText('Description · Rejected')).toBeVisible();
    expect(server.product.description).toBe('Camera with lens');
    await page.getByRole('button', { name: 'Review listing price', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Proposed value' }).fill('600');
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await page
      .getByRole('checkbox', { name: 'I confirm applying a listing price below cost' })
      .check();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText('Listing price · Accepted')).toBeVisible();
    expect(server.decisions[2]).toEqual({
      revision: 3,
      proposalId: 'price',
      action: 'accept',
      editedValue: 600,
      allowBelowCost: true,
    });
    expect(server.listing.price).toBe(600);
    expect(server.product.sellingPrice).toBe(1050);
    await page.reload();
    await expect(page.getByText('Title · Accepted')).toBeVisible();
    await expect(page.getByText('Description · Rejected')).toBeVisible();
    await expect(page.getByText('Listing price · Accepted')).toBeVisible();
    await page
      .locator('.MuiCard-root')
      .filter({ has: page.getByText('Product assistant', { exact: true }) })
      .screenshot({
        path: testInfo.outputPath(`saved-review-${viewport.width}.png`),
        animations: 'disabled',
      });
    expect(
      server.requests.some((request) => request.includes('publish') || request.includes('relist'))
    ).toBe(false);
  });
}
test('locks stale decisions after conflict and permits explicit regeneration', async ({ page }) => {
  const server = await mockReview(page);
  await page.goto('/products/p1');
  await page.getByRole('button', { name: 'Review title', exact: true }).click();
  server.conflict();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('The saved product, listing or review changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review title', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject title', exact: true })).toBeDisabled();
  expect(server.product.name).toBe('Camera kit');
  await page.getByRole('button', { name: 'Suggest improvements' }).click();
  await expect(page.getByRole('button', { name: 'Review title', exact: true })).toBeEnabled();
});
test('shows restore failure and retries without presenting an empty review', async ({ page }) => {
  const server = await mockReview(page);
  server.failRestore(true);
  await page.goto('/products/p1');
  await expect(page.getByText('Unable to load saved suggestions.')).toBeVisible();
  await expect(page.getByText('Ask Hermes for wording and price ideas.')).not.toBeVisible();
  server.failRestore(false);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Title · Pending review')).toBeVisible();
});
