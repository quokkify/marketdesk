import { PricingValidator } from '../PricingValidator';

describe('product list query validation', () => {
  // Regression guard: zod dropped the unknown key, so the Needs action tab listed every product.
  it('keeps the needsAction filter', () => {
    const result = new PricingValidator().validateListQuery({
      workspaceId: 'w-1',
      needsAction: true,
      limit: 1,
    });
    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.needsAction).toBe(true);
  });
});
