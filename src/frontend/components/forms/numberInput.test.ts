import type { SyntheticEvent } from 'react';
import { blurOnWheel, numberInputProps } from './numberInput.js';

function fakeWheelEvent(blur: () => void): SyntheticEvent {
  return { currentTarget: { blur } } as unknown as SyntheticEvent;
}

describe('numberInput', () => {
  // Regression guard: wheel over a focused number input used to change the price by one step per tick.
  it('blurs the input on wheel', () => {
    const blur = jest.fn();
    blurOnWheel(fakeWheelEvent(blur));
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('keeps extra attributes and adds the wheel handler', () => {
    const blur = jest.fn();
    const props = numberInputProps({ min: 0, step: '0.01' });
    expect(props.min).toBe(0);
    expect(props.step).toBe('0.01');
    props.onWheel(fakeWheelEvent(blur));
    expect(blur).toHaveBeenCalledTimes(1);
  });
});
