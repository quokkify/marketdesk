import path from 'node:path';
import { DomainError } from '../../domain/shared/DomainError';
import type { ErrorInfo } from '../ports/IRunRecorder';

const SQLSTATE_LENGTH = 5;
const FRAME_LINE = /\(?([^()\s]+):(\d+):\d+\)?$/;

function firstApplicationFrame(stack: string | undefined, cwd: string): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    const match = FRAME_LINE.exec(line.trim());
    if (!match) continue;
    const file = match[1];
    const isApp =
      (file.includes('/src/backend/') || file.includes('/dist/backend/')) &&
      !file.includes('/node_modules/');
    if (isApp) return `${path.relative(cwd, file)}:${match[2]}`;
  }
  return undefined;
}

export function describeError(error: unknown, cwd: string = process.cwd()): ErrorInfo {
  if (!(error instanceof Error)) {
    return { name: 'NonError', message: String(error) };
  }
  const info: ErrorInfo = { name: error.name, message: error.message };
  const fields = error as Error & { code?: unknown; constraint?: unknown; table?: unknown };
  if (typeof fields.code === 'string') info.code = fields.code;
  if (error instanceof DomainError && error.details) info.details = error.details;
  if (
    typeof fields.code === 'string' &&
    fields.code.length === SQLSTATE_LENGTH &&
    (typeof fields.constraint === 'string' || typeof fields.table === 'string')
  ) {
    info.pg = {
      code: fields.code,
      constraint: typeof fields.constraint === 'string' ? fields.constraint : null,
      table: typeof fields.table === 'string' ? fields.table : null,
    };
  }
  const at = firstApplicationFrame(error.stack, cwd);
  if (at) info.at = at;
  return info;
}
