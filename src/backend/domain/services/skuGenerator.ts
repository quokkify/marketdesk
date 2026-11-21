const SKU_PREFIX = 'MD-';
const SKU_ID_LENGTH = 10;

export function generateSku(productId: string): string {
  return `${SKU_PREFIX}${productId.replace(/-/g, '').slice(0, SKU_ID_LENGTH).toUpperCase()}`;
}
