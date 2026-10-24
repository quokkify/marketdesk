// Response formatting helpers producing the exact ARCHITECTURE.md §18 envelope.
// Every controller translates its Result/data through these so the wire contract the
// frontend (RTK Query) depends on stays consistent.
//
//   Success:   { success: true, data }
//   Paginated: { success: true, data: [...], pagination: { page, limit, total, totalPages } }
//   Error:     { success: false, error: { code, message, details? } }

import type { Response } from 'express';
import { DomainError } from '../../../domain/shared/DomainError';
import { ERROR_CODES } from '../../../../shared/constants';
import { isProduction } from '../../../config/env';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: ErrorDetail[] | Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Postgres constraint violations that escaped a controller, typically the loser of
// a race that a find-then-write pre-check could not close. The driver message names
// the constraint and echoes the conflicting values, so a generic message replaces it.
const PG_CONFLICT_MESSAGES = new Map<string, string>([
  ['23505', 'Resource already exists'], // unique_violation
  ['23503', 'Request conflicts with related records'], // foreign_key_violation
]);

function pgConflictMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? PG_CONFLICT_MESSAGES.get(error.code) : undefined;
}

// Map a DomainError (or arbitrary error) to an HTTP status code (§5 / §19).
export function statusForError(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    return 413;
  }
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return 400;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
      case 'RECONCILIATION_REQUIRED':
        return 409;
      case 'INVALID_STATE':
      case 'GUARDRAIL_VIOLATION':
        return 422;
      case 'SERVICE_UNAVAILABLE':
        return 503;
      default:
        return 500;
    }
  }
  if (pgConflictMessage(error)) {
    return 409;
  }
  return 500;
}

export function toErrorBody(error: unknown): ErrorBody {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    return {
      code: ERROR_CODES.PAYLOAD_TOO_LARGE,
      message: 'Request body exceeds the configured limit',
    };
  }
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  const conflictMessage = pgConflictMessage(error);
  if (conflictMessage) {
    return { code: ERROR_CODES.CONFLICT, message: conflictMessage };
  }
  // Never leak internal error details/stack traces in production.
  const message =
    !isProduction && error instanceof Error ? error.message : 'Internal server error';
  return { code: ERROR_CODES.INTERNAL_ERROR, message };
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function paginated<T>(
  res: Response,
  items: T[],
  pagination: PaginationMeta,
): Response {
  return res.status(200).json({ success: true, data: items, pagination });
}

// Send an error envelope directly. Prefer forwarding domain errors to
// ErrorHandlingMiddleware via next(); this is used where a direct send is required
// (auth challenges, validation middleware).
export function fail(
  res: Response,
  error: unknown,
  status?: number,
  body?: ErrorBody,
): Response {
  return res
    .status(status ?? statusForError(error))
    .json({ success: false, error: body ?? toErrorBody(error) });
}
