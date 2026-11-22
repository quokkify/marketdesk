// Number inputs change their value on wheel while focused; blurring on wheel keeps typed values intact
// and still lets the page scroll.
import type { SyntheticEvent } from 'react';

export function blurOnWheel(event: SyntheticEvent): void {
  (event.currentTarget as HTMLInputElement).blur();
}

export function numberInputProps<T extends object>(extra: T): T & { onWheel: typeof blurOnWheel } {
  return { ...extra, onWheel: blurOnWheel };
}
