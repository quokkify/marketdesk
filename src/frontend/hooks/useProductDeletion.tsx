// Delete-with-confirmation flow shared by the catalogue rows and the product
// detail page: one dialog, the server's message on refusal, a toast on success.
import React, { useRef, useState } from 'react';
import type { Product } from '@shared/types';
import { useDeleteProduct } from '../services/hooks/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { DeleteProductDialog } from '../components/product-detail/DeleteProductDialog.js';

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

export function useProductDeletion(onDeleted: (product: Product) => void) {
  const dispatch = useAppDispatch();
  const [deleteProduct, { isLoading: deleting }] = useDeleteProduct();
  const [target, setTarget] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const requestDelete = (product: Product) => {
    setError(null);
    setTarget(product);
    setOpen(true);
  };

  const cancel = () => {
    if (inFlight.current) return;
    setOpen(false);
  };

  const confirm = async () => {
    if (!open || !target || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await deleteProduct(target.id).unwrap();
      setOpen(false);
      dispatch(enqueueToast({ message: `Deleted ${target.name}.`, severity: 'success' }));
      onDeleted(target);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
    }
  };

  return {
    requestDelete,
    dialog: (
      <DeleteProductDialog
        open={open}
        productName={target?.name ?? ''}
        deleting={deleting}
        error={error}
        onCancel={cancel}
        onConfirm={() => void confirm()}
      />
    ),
  };
}
