import { emptyProductValues } from './productFormModel';
import {
  PRODUCT_WIZARD_DRAFT_MAX_AGE_MS,
  hasMeaningfulProductWizardDraft,
  productWizardDraftStorageKey,
  readProductWizardDraft,
  removeProductWizardDraft,
  writeProductWizardDraft,
} from './productWizardDraft';
import type { ProductWizardDraftState } from './productWizardDraft';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function draft(): ProductWizardDraftState {
  return {
    values: { ...emptyProductValues(), name: 'Saved camera', images: ['camera.jpg'] },
    activeStep: 1,
    targetMarketplace: 'olx',
    olxCategory: { providerCategoryId: '123', name: 'Cameras', path: ['Electronics', 'Cameras'] },
    createdProductId: null,
  };
}

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'Camera',
    description: 'Camera in good condition with all required product details.',
    sellingPrice: 100,
    images: ['camera.jpg'],
  };
}

describe('product wizard draft persistence', () => {
  it('round-trips a versioned workspace/user-scoped draft', () => {
    const storage = new MemoryStorage();
    const key = productWizardDraftStorageKey('workspace/1', 'user@example.com');

    expect(writeProductWizardDraft(storage, key, draft(), 1_000)).toBe(true);
    expect(readProductWizardDraft(storage, key, 2_000)).toEqual(draft());

    const newerDraft = {
      ...draft(),
      values: { ...draft().values, name: 'Updated in another tab' },
    };
    storage.setItem(key, JSON.stringify({ ...newerDraft, version: 2, updatedAt: 1_500 }));
    expect(readProductWizardDraft(storage, key, 2_000)).toEqual(newerDraft);
    expect(key).toContain('workspace%2F1');
    expect(key).toContain('user%40example.com');
  });

  it('ignores malformed, future, stale, and unsupported-version values', () => {
    const storage = new MemoryStorage();
    const key = 'draft';

    storage.setItem(key, '{not-json');
    expect(readProductWizardDraft(storage, key, 10_000)).toBeNull();

    storage.setItem(key, JSON.stringify({ ...draft(), version: 99, updatedAt: 1_000 }));
    expect(readProductWizardDraft(storage, key, 10_000)).toBeNull();

    storage.setItem(key, JSON.stringify({ ...draft(), version: 2, updatedAt: 80_001 }));
    expect(readProductWizardDraft(storage, key, 10_000)).toBeNull();

    storage.setItem(key, JSON.stringify({ ...draft(), version: 2, updatedAt: 1_000 }));
    expect(
      readProductWizardDraft(storage, key, 1_000 + PRODUCT_WIZARD_DRAFT_MAX_AGE_MS + 1)
    ).toBeNull();
  });

  it('rejects invalid form values and removes discarded drafts', () => {
    const storage = new MemoryStorage();
    const key = 'draft';
    storage.setItem(
      key,
      JSON.stringify({
        ...draft(),
        values: { ...draft().values, images: ['valid.jpg', 42] },
        version: 2,
        updatedAt: 1_000,
      })
    );

    expect(readProductWizardDraft(storage, key, 2_000)).toBeNull();
    expect(removeProductWizardDraft(storage, key)).toBe(true);
    expect(storage.getItem(key)).toBeNull();
  });

  it('marks only non-empty wizard state as meaningful', () => {
    expect(
      hasMeaningfulProductWizardDraft({
        values: emptyProductValues(),
        activeStep: 0,
        targetMarketplace: null,
        olxCategory: null,
        createdProductId: null,
      })
    ).toBe(false);
    expect(hasMeaningfulProductWizardDraft(draft())).toBe(true);
    const empty = {
      values: emptyProductValues(),
      activeStep: 0 as const,
      targetMarketplace: null,
      olxCategory: null,
      createdProductId: null,
    };
    expect(hasMeaningfulProductWizardDraft({ ...empty, olxCategory: draft().olxCategory })).toBe(
      true
    );
    expect(hasMeaningfulProductWizardDraft({ ...empty, createdProductId: 'p1' })).toBe(true);
  });

  it('converts a six-step draft to the review screen', () => {
    const storage = new MemoryStorage();
    const now = 5_000;
    const v1Key = 'marketdesk.productWizardDraft.v1.w1.u1';
    storage.setItem(
      v1Key,
      JSON.stringify({
        version: 1,
        updatedAt: now,
        activeStep: 5,
        targetMarketplace: 'olx',
        values: { ...validValues(), sku: 'CAM-001', category: 'Electronics' },
      })
    );
    const key = productWizardDraftStorageKey('w1', 'u1');
    const draft = readProductWizardDraft(storage, key, now);
    expect(draft).toMatchObject({ activeStep: 1, olxCategory: null, createdProductId: null });
    expect(draft?.values.sku).toBe('CAM-001');
    expect(draft?.values.category).toBe('Electronics');
    expect(storage.getItem(v1Key)).toBeNull();
    expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ version: 2, activeStep: 1 });
    expect(readProductWizardDraft(storage, key, now)).toEqual(draft);
  });

  it('keeps a version 1 draft on the photos screen at step 0', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'marketdesk.productWizardDraft.v1.w1.u1',
      JSON.stringify({
        version: 1,
        updatedAt: 1_000,
        activeStep: 0,
        targetMarketplace: null,
        values: validValues(),
      })
    );
    expect(
      readProductWizardDraft(storage, productWizardDraftStorageKey('w1', 'u1'), 2_000)
    ).toMatchObject({ activeStep: 0, targetMarketplace: null });
  });

  it('rejects a stored activeStep above 1', () => {
    const storage = new MemoryStorage();
    const key = productWizardDraftStorageKey('w1', 'u1');
    storage.setItem(
      key,
      JSON.stringify({ ...draft(), activeStep: 2, version: 2, updatedAt: 1_000 })
    );
    expect(readProductWizardDraft(storage, key, 2_000)).toBeNull();
  });

  it('rejects a malformed stored OLX category', () => {
    const storage = new MemoryStorage();
    const key = 'draft';
    storage.setItem(
      key,
      JSON.stringify({
        ...draft(),
        olxCategory: { providerCategoryId: '123', name: 'Cameras', path: 'Electronics' },
        version: 2,
        updatedAt: 1_000,
      })
    );
    expect(readProductWizardDraft(storage, key, 2_000)).toBeNull();
  });

  it('falls back to an isolated session draft when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const key = 'unavailable-draft';
    const original = draft();

    expect(readProductWizardDraft(storage, key)).toBeNull();
    expect(writeProductWizardDraft(storage, key, original)).toBe(false);
    original.values.name = 'Mutated after write';
    expect(readProductWizardDraft(storage, key)).toEqual(draft());
    expect(removeProductWizardDraft(storage, key)).toBe(false);
    expect(readProductWizardDraft(storage, key)).toBeNull();
  });

  it('uses the volatile fallback when no Storage object is available', () => {
    const key = 'missing-storage-draft';
    expect(writeProductWizardDraft(null, key, draft())).toBe(false);
    expect(readProductWizardDraft(null, key)).toEqual(draft());
    expect(removeProductWizardDraft(null, key)).toBe(false);
    expect(readProductWizardDraft(null, key)).toBeNull();
  });
});
