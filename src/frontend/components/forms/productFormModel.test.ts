import {
  belowCostConfirmationRequired,
  emptyProductValues,
  marginWarning,
  productFieldErrorsFromApi,
  productToValues,
  profitSummary,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel';

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'AirPods 4',
    sku: 'AIRPODS4-PL-001',
    description: 'AirPods in good condition with all required details.',
    costPrice: 649,
    sellingPrice: 399,
    category: 'electronics',
  };
}

describe('productFormModel below-cost pricing', () => {
  it('keeps below-cost pricing as a warning instead of a validation error', () => {
    const values = validValues();

    expect(validateProductValues(values)).toEqual({});
    expect(marginWarning(values)).toContain('250');
    expect(marginWarning(values)).toContain('-62.7% margin');
  });

  it('marks below-cost submissions with the documented API flag', () => {
    expect(belowCostConfirmationRequired(validValues(), false)).toBe(true);
    expect(belowCostConfirmationRequired(validValues(), true)).toBe(false);
    expect(toProductSubmissionValues(validValues()).allowBelowCost).toBe(true);
  });

  it('does not require confirmation at or above the cost boundary', () => {
    expect(belowCostConfirmationRequired({ ...validValues(), sellingPrice: 649 }, false)).toBe(
      false
    );
    expect(
      belowCostConfirmationRequired({ ...validValues(), costPrice: 0, sellingPrice: 0 }, false)
    ).toBe(false);
  });

  it('warns and marks zero-price submissions when cost is positive', () => {
    const values = { ...validValues(), sellingPrice: 0 };

    expect(validateProductValues(values)).toEqual({});
    expect(marginWarning(values)).toContain('649');
    expect(marginWarning(values)).toContain('zero selling price');
    expect(toProductSubmissionValues(values).allowBelowCost).toBe(true);
  });

  it('preserves blank imported cost prices through edit submission', () => {
    const values = productToValues({
      id: 'product-1',
      workspaceId: 'workspace-1',
      sku: 'OLX-workspace-1-olx-1',
      name: 'Imported camera',
      description: 'Imported description with enough detail.',
      costPrice: null,
      sellingPrice: 100,
      condition: 'unknown',
      category: 'Electronics',
      status: 'active',
      tags: [],
      images: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(values.costPrice).toBeNull();
    expect(validateProductValues(values)).toEqual({});
    expect(toProductSubmissionValues(values).costPrice).toBeNull();
  });
});

describe('productFormModel profit summary', () => {
  it('computes profit and margin from a known cost', () => {
    const summary = profitSummary(800, 1050);
    expect(summary?.profit).toBe(250);
    expect(summary?.marginPercent).toBeCloseTo(23.81, 2);
  });

  it('reports no profit when the cost is unknown and no margin for a zero price', () => {
    expect(profitSummary(null, 100)).toBeNull();
    expect(profitSummary(10, 0)).toEqual({ profit: -10, marginPercent: null });
  });
});

describe('productFormModel API validation errors', () => {
  function apiError(error: { code: string; message: string; details?: unknown[] }) {
    return { status: 400, data: { success: false, error } };
  }

  it('maps request validation details to the product fields they name', () => {
    const result = productFieldErrorsFromApi(
      apiError({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [
          { field: 'costPrice', message: 'Invalid input: expected number, received null' },
          { field: 'images.0', message: 'Too small: expected string to have >=1 characters' },
          { field: '(root)', message: 'Unrecognized' },
        ],
      })
    );

    expect(result).toEqual({
      message: 'Request validation failed',
      fieldErrors: {
        costPrice: 'Invalid input: expected number, received null',
        images: 'Too small: expected string to have >=1 characters',
      },
    });
  });

  it('explains a missing below-cost confirmation on the selling price', () => {
    const result = productFieldErrorsFromApi(
      apiError({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [
          { field: 'allowBelowCost', message: 'must be true when sellingPrice is below costPrice' },
        ],
      })
    );

    expect(result.fieldErrors).toEqual({
      sellingPrice: 'Selling price is below cost. Confirm the below-cost price to continue.',
    });
  });

  it('reads the field prefix of an application validation message without details', () => {
    const result = productFieldErrorsFromApi(
      apiError({
        code: 'VALIDATION_ERROR',
        message: 'description: Too small: expected string to have >=20 characters',
      })
    );

    expect(result.fieldErrors).toEqual({
      description: 'Too small: expected string to have >=20 characters',
    });
  });

  it('attaches a duplicate SKU conflict to the SKU field', () => {
    const result = productFieldErrorsFromApi({
      status: 409,
      data: { success: false, error: { code: 'CONFLICT', message: 'SKU already exists: CAM-1' } },
    });

    expect(result.fieldErrors).toEqual({ sku: 'SKU already exists: CAM-1' });
  });

  it('leaves unrelated failures without field errors', () => {
    expect(productFieldErrorsFromApi(new Error('Network down'))).toEqual({
      fieldErrors: {},
      message: 'Network down',
    });
    expect(productFieldErrorsFromApi({ status: 'FETCH_ERROR' })).toEqual({
      fieldErrors: {},
      message: 'Request failed',
    });
  });
});
