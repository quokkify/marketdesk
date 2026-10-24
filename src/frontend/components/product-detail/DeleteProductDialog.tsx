// Confirmation for permanently deleting one product from the catalogue.
import React from 'react';
import { Box } from '@mui/material';
import type { Product } from '@shared/types';
import { ConfirmDialog } from '../common/ConfirmDialog.js';

export interface DeleteProductDialogProps {
  product: Pick<Product, 'name'> | null;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

// Deleting removes the product and its MarketDesk listings; it never removes
// an advert from OLX, so the copy says so. A refusal shows the server message.
export const DeleteProductDialog: React.FC<DeleteProductDialogProps> = ({
  product,
  deleting,
  error,
  onCancel,
  onConfirm,
}) => (
  <ConfirmDialog
    open={Boolean(product)}
    title="Delete product?"
    message={
      <>
        {`${product?.name ?? 'This product'} and its MarketDesk listings will be permanently deleted. Adverts already on OLX are not removed.`}
        {error && (
          <Box component="span" role="alert" sx={{ display: 'block', mt: 1.5, color: 'error.main', fontWeight: 600 }}>
            {error}
          </Box>
        )}
      </>
    }
    confirmLabel={deleting ? 'Deleting…' : 'Delete product'}
    confirmColor="error"
    loading={deleting}
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);
