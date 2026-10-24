// HERMES_PROVIDER_MODE selects how AI calls are routed: auto, hermes or offline.

import { resolveHermesProviderMode } from '../hermesProviderMode';

describe('resolveHermesProviderMode', () => {
  it.each([undefined, '', '   '])('defaults to auto when HERMES_PROVIDER_MODE is %p', (value) => {
    expect(resolveHermesProviderMode(value)).toBe('auto');
  });

  it.each([
    ['auto', 'auto'],
    ['hermes', 'hermes'],
    ['offline', 'offline'],
    [' offline ', 'offline'],
  ])('accepts %p as %p', (value, mode) => {
    expect(resolveHermesProviderMode(value)).toBe(mode);
  });

  it.each(['Offline', 'online', 'true', 'heuristic'])('rejects %p with a clear error', (value) => {
    expect(() => resolveHermesProviderMode(value)).toThrow(
      'HERMES_PROVIDER_MODE must be one of auto, hermes, offline',
    );
  });
});
