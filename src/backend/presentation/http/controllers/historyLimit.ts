import { ValidationError } from '../../../domain/shared/DomainError';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

// The ?limit= of a run history list: absent means the default, anything but an integer in 1..50 is a 400.
export function parseHistoryLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_HISTORY_LIMIT;
  const limit = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new ValidationError(`limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}`);
  }
  return limit;
}
