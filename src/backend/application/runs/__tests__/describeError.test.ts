import { describeError } from '../describeError';
import { GuardrailViolationError } from '../../../domain/shared/DomainError';

describe('describeError', () => {
  it('keeps DomainError code and details', () => {
    const info = describeError(
      new GuardrailViolationError('blocked', { categoryDecision: { allowed: false } }),
    );
    expect(info).toMatchObject({
      name: 'GuardrailViolationError',
      code: 'GUARDRAIL_VIOLATION',
      details: { categoryDecision: { allowed: false } },
    });
  });

  it('reads SQLSTATE, constraint and table from a pg error and never its detail', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'listings_pkey',
      table: 'listings',
      detail: 'Key (id)=(secret-row) exists',
    });
    const info = describeError(pgError);
    expect(info.pg).toEqual({ code: '23505', constraint: 'listings_pkey', table: 'listings' });
    expect(JSON.stringify(info)).not.toContain('secret-row');
  });

  it('reports the first application frame relative to cwd', () => {
    const error = new Error('x');
    error.stack =
      'Error: x\n    at a (/repo/node_modules/lib/i.js:1:1)\n    at b (/repo/src/backend/x/Y.ts:42:7)';
    expect(describeError(error, '/repo').at).toBe('src/backend/x/Y.ts:42');
  });

  it('describes a non-Error value', () => {
    expect(describeError('boom')).toEqual({ name: 'NonError', message: 'boom' });
  });
});
