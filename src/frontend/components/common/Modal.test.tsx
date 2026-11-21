import React from 'react';
import { Modal } from './Modal';

describe('Modal close lock', () => {
  it('removes the dialog close handler while a protected mutation is in flight', () => {
    const onClose = jest.fn();
    const element = Modal({
      open: true,
      onClose,
      closeDisabled: true,
      title: 'Protected request',
      children: 'Pending',
    });

    expect(React.isValidElement(element)).toBe(true);
    expect((element as React.ReactElement<{ onClose?: unknown }>).props.onClose).toBeUndefined();
  });
});

describe('Modal full screen on mobile', () => {
  it('styles the paper full screen below sm only when asked', () => {
    const dialogProps = (fullScreenOnMobile?: boolean) =>
      (
        Modal({ open: true, onClose: () => undefined, fullScreenOnMobile }) as React.ReactElement<{
          slotProps?: { paper?: { sx?: unknown } };
        }>
      ).props;

    expect(dialogProps().slotProps).toBeUndefined();
    expect(typeof dialogProps(true).slotProps?.paper?.sx).toBe('function');
  });
});
