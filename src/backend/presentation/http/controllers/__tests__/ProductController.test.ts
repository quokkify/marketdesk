import { ProductController, parseStringList } from '../ProductController';
import { statusForError } from '../../formatters/ResponseFormatter';
import type { SaleVerdictRuns } from '../../../../application/services/verdict/SaleVerdictRuns';
import type { SaleVerdict } from '../../../../../shared/types';

describe('ProductController list parsing', () => {
  it('preserves commas inside JSON-encoded tag values', () => {
    expect(parseStringList('["home, office","featured"]')).toEqual(['home, office', 'featured']);
  });

  it('keeps backward compatibility with comma-separated tags', () => {
    expect(parseStringList('audio, featured')).toEqual(['audio', 'featured']);
  });

  it('fails closed for malformed JSON arrays', () => {
    expect(parseStringList('["unterminated"')).toBeUndefined();
    expect(parseStringList('["valid", 2]')).toBeUndefined();
  });
});

describe('ProductController recheck', () => {
  it('forwards the authenticated workspace and actor to the non-publishing service', async () => {
    const result = {
      productId: 'product-1', workspaceId: 'workspace-1',
      productUpdatedAt: '2026-07-22T06:00:00.000Z', checkedAt: '2026-07-22T06:01:00.000Z',
      status: 'ready', canPublish: true, autoApplied: false, items: [],
      category: {
        providerCategoryId: 'provider-1', path: ['Electronics', 'Projectors'], confidence: 0.99,
        isLeaf: true, taxonomyVerifiedAt: '2026-07-22T05:00:00.000Z',
        taxonomyStaleAt: '2026-07-23T05:00:00.000Z', reason: null,
        suggestion: null, confirmationRequired: false,
      },
    } as const;
    const recheck = jest.fn(async () => result);
    const controller = new ProductController(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      () => 'id', { recheck } as never,
    );
    const req = {
      params: { id: 'product-1' },
      body: { listingId: 'listing-1' },
      user: { workspaceId: 'workspace-1', userId: 'user-1' },
    } as never;
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as never;
    const next = jest.fn();

    await controller.recheck(req, res, next);

    expect(recheck).toHaveBeenCalledWith({
      productId: 'product-1', listingId: 'listing-1', workspaceId: 'workspace-1', actorId: 'user-1',
    });
    expect(json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('ProductController price research refresh', () => {
  const run = { id: 'run-1', status: 'queued' } as unknown as SaleVerdict;

  async function refresh(options: {
    configured?: boolean;
    currency?: string | null;
    product?: object | null;
    enqueued?: boolean;
  } = {}) {
    const request = jest.fn(async () => ({ run, enqueued: options.enqueued ?? true }));
    const findProduct = jest.fn(async () => (options.product === undefined ? { id: 'product-1' } : options.product));
    const findListings = jest.fn(async () =>
      options.currency === null ? [] : [{ price: { currency: options.currency ?? 'PLN' } }]);
    const controller = new ProductController(
      {} as never, {} as never, {} as never, { findByIdForWorkspace: findProduct } as never,
      { findByProduct: findListings } as never, {} as never,
      () => 'id', undefined, undefined, undefined, undefined, undefined,
      { request } as unknown as SaleVerdictRuns, options.configured ?? true,
    );
    const req = { params: { id: 'product-1' }, user: { workspaceId: 'workspace-1', userId: 'user-1' } } as never;
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const next = jest.fn();
    await controller.refreshPriceResearch(req, { status } as never, next);
    return { request, status, json, next };
  }

  it('requests the price scope with a forced research and answers 202 with the run', async () => {
    const { request, status, json } = await refresh();

    expect(request).toHaveBeenCalledWith('workspace-1', 'product-1', ['price'], 'manual', { forceResearch: true });
    expect(status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ success: true, data: { run } });
  });

  it('answers 200 with the run already queued or running', async () => {
    const { status, json } = await refresh({ enqueued: false });

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ success: true, data: { run } });
  });

  it.each([
    ['without a research profile', { configured: false }, 503, 'Market search is not configured'],
    ['for a listing in another currency', { currency: 'EUR' }, 422, 'OLX search needs a PLN listing'],
    ['for a product without a listing', { currency: null }, 422, 'OLX search needs a PLN listing'],
  ])('answers synchronously %s and requests no run', async (_name, options, code, message) => {
    const { request, next, status } = await refresh(options);

    const error = next.mock.calls[0]?.[0];
    expect(statusForError(error)).toBe(code);
    expect(error).toMatchObject({ message });
    expect(request).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('answers 404 for a product of another workspace before anything else', async () => {
    const { request, next } = await refresh({ product: null, configured: false });

    expect(statusForError(next.mock.calls[0]?.[0])).toBe(404);
    expect(request).not.toHaveBeenCalled();
  });
});
