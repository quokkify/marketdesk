import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DeleteProductDialog } from './DeleteProductDialog';

type DialogElement = React.ReactElement<React.ComponentProps<typeof ConfirmDialog>>;

function dialog(props: Partial<React.ComponentProps<typeof DeleteProductDialog>>): DialogElement {
  return DeleteProductDialog({
    product: { name: 'Wireless Headphones Pro' },
    deleting: false,
    error: null,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    ...props,
  }) as DialogElement;
}

describe('DeleteProductDialog', () => {
  it('asks to confirm a permanent delete and says OLX adverts are not removed', () => {
    const onConfirm = jest.fn();
    const element = dialog({ onConfirm });
    const message = renderToStaticMarkup(<>{element.props.message}</>);

    expect(element.type).toBe(ConfirmDialog);
    expect(element.props.open).toBe(true);
    expect(element.props.title).toBe('Delete product?');
    expect(element.props.confirmLabel).toBe('Delete product');
    expect(element.props.confirmColor).toBe('error');
    expect(message).toContain('Wireless Headphones Pro and its MarketDesk listings will be permanently deleted.');
    expect(message).toContain('Adverts already on OLX are not removed.');
    element.props.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when the delete is refused', () => {
    const element = dialog({ error: 'Remove the live OLX listing before deleting this product.' });
    const message = renderToStaticMarkup(<>{element.props.message}</>);

    expect(message).toContain('role="alert"');
    expect(message).toContain('Remove the live OLX listing before deleting this product.');
  });

  it('locks the dialog while the delete is in flight and stays closed without a product', () => {
    expect(dialog({ deleting: true }).props).toMatchObject({ loading: true, confirmLabel: 'Deleting…' });
    expect(dialog({ product: null }).props.open).toBe(false);
  });
});
