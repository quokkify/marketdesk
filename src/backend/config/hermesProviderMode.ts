import { HERMES_PROVIDER_MODES, type HermesProviderMode } from '../../shared/types';

// HERMES_PROVIDER_MODE: unset or blank means auto. Any other value outside the
// supported list fails at boot, so a typo never silently changes AI routing.
export function resolveHermesProviderMode(value: string | undefined): HermesProviderMode {
  const requested = value?.trim() || 'auto';
  const mode = HERMES_PROVIDER_MODES.find((candidate) => candidate === requested);
  if (!mode) {
    throw new Error(
      `HERMES_PROVIDER_MODE must be one of ${HERMES_PROVIDER_MODES.join(', ')}; received "${value}"`,
    );
  }
  return mode;
}
