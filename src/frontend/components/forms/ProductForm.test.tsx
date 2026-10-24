import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import type { Product } from '@shared/types';
import { lightTheme } from '../../theme/lightTheme';
import { ProductForm, unsavedImageDeleter } from './ProductForm';

const savedPhoto =
  '/uploads/workspaces/0123456789abcdef01234567/products/123e4567-e89b-42d3-a456-426614174000.webp';
const newPhotoId = '9b2f7c1e-5d3a-4c8b-9e6f-2a1b3c4d5e6f';

const product: Product = {
  id: 'product-1',
  workspaceId: 'workspace-1',
  sku: 'SKU-38412',
  name: 'Wireless Headphones Pro',
  description: 'Over-ear wireless headphones with a hard case and cable.',
  costPrice: 149,
  sellingPrice: 329,
  condition: 'new',
  category: 'Audio',
  status: 'draft',
  tags: ['audio'],
  images: [savedPhoto, 'https://example.test/side.jpg'],
  createdAt: '2026-07-14T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
};

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ThemeProvider theme={lightTheme}>{node}</ThemeProvider>);
}

describe('ProductForm photos', () => {
  it('edits photos with the uploader instead of pasted image URLs', () => {
    const html = render(
      <ProductForm
        initial={product}
        onSubmit={() => undefined}
        onUploadImage={() => Promise.reject(new Error('not used'))}
      />
    );

    expect(html).toContain('aria-label="Upload product photos"');
    expect(html).toContain('Add photos (2/12)');
    expect(html).toContain(`src="${savedPhoto}"`);
    expect(html).not.toContain('Image URLs');
    expect(html).not.toContain('Paste an image URL');
  });

  it('keeps photos saved on the product in storage until the edit is saved', async () => {
    const onDeleteImage = jest.fn(() => Promise.resolve());
    const deleteImage = unsavedImageDeleter(product.images, onDeleteImage);

    await deleteImage!('123e4567-e89b-42d3-a456-426614174000');
    expect(onDeleteImage).not.toHaveBeenCalled();
    await deleteImage!(newPhotoId);
    expect(onDeleteImage).toHaveBeenCalledWith(newPhotoId);
    expect(unsavedImageDeleter(product.images, undefined)).toBeUndefined();
  });
});
