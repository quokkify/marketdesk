import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  limitProductImageFiles,
  moveProductImage,
  ProductImageUploader,
  selectProductImageFiles,
  unsupportedFilesNotice,
  uploadedImageId,
} from './ProductImageUploader';

function imageFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('ProductImageUploader helpers', () => {
  it('reorders photos and promotes a selected cover without mutating input', () => {
    const images = ['/uploads/one.jpg', '/uploads/two.jpg', '/uploads/three.jpg'];

    expect(moveProductImage(images, 2, 0)).toEqual([
      '/uploads/three.jpg',
      '/uploads/one.jpg',
      '/uploads/two.jpg',
    ]);
    expect(images).toEqual(['/uploads/one.jpg', '/uploads/two.jpg', '/uploads/three.jpg']);
    expect(moveProductImage(images, 3, 0)).toBe(images);
  });

  it('extracts only opaque uploaded image ids from durable URLs', () => {
    expect(
      uploadedImageId(
        '/uploads/workspaces/0123456789abcdef01234567/products/123e4567-e89b-42d3-a456-426614174000.webp'
      )
    ).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(uploadedImageId('https://example.com/photo.jpg')).toBeNull();
    expect(uploadedImageId('/uploads/../../secret.jpg')).toBeNull();
  });

  it('keeps the supported files and names the unsupported ones', () => {
    const jpg = imageFile('x.jpg', 'image/jpeg');

    expect(selectProductImageFiles([jpg, imageFile('x.heic', 'image/heic')])).toEqual({
      accepted: [jpg],
      rejectedNames: ['x.heic'],
    });
    expect(unsupportedFilesNotice(['a.heic', 'b.gif'])).toBe(
      'Skipped unsupported files: a.heic, b.gif'
    );
    expect(unsupportedFilesNotice([])).toBeNull();
  });

  it('enforces the remaining photo capacity', () => {
    const files = [
      imageFile('one.jpg', 'image/jpeg'),
      imageFile('two.png', 'image/png'),
      imageFile('three.webp', 'image/webp'),
    ];

    expect(limitProductImageFiles(files, 2)).toEqual({
      selected: files.slice(0, 2),
      error: 'Only 2 more photos can be added.',
    });
    expect(limitProductImageFiles(files, 3)).toEqual({ selected: files });
    expect(limitProductImageFiles(files, 0)).toEqual({
      selected: [],
      error: 'The 12-photo limit has been reached.',
    });
  });
});

describe('ProductImageUploader', () => {
  it('invites taking or choosing photos without forcing the camera', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductImageUploader, {
        images: [],
        onChange: () => undefined,
        onUpload: () => Promise.reject(new Error('not used')),
      })
    );

    expect(html).toContain('Take or choose photos');
    expect(html).not.toContain('capture');
  });
});
