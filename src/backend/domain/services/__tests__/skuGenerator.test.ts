import { generateSku } from '../skuGenerator';

describe('generateSku', () => {
  it('derives a SKU from the product id', () => {
    expect(generateSku('3f2a9c1e-77b4-4d0a-9c1e-000000000000')).toBe('MD-3F2A9C1E77');
  });
});
