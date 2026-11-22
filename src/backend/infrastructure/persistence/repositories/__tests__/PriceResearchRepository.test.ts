import type { Pool } from 'pg';
import { PriceResearchRepository } from '../PriceResearchRepository';
import { NotFoundError } from '../../../../domain/shared/DomainError';

// A pool whose product is gone: the placeholder insert and the locked select both find nothing.
function goneProductPool() {
  const statements: string[] = [];
  const client = {
    query: jest.fn(async (text: string) => {
      statements.push(text.trim().split(/\s+/)[0]!);
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return { statements, client, pool: { connect: async () => client } as unknown as Pool };
}

describe('PriceResearchRepository locked saves (mocked; no PostgreSQL execution)', () => {
  it('refuses a seller edit of a product that is gone with a 404 and rolls back', async () => {
    const { statements, client, pool } = goneProductPool();
    const apply = jest.fn();
    const repository = new PriceResearchRepository(pool);

    await expect(repository.saveEditLocked('w1', 'p1', apply)).rejects.toBeInstanceOf(NotFoundError);

    expect(apply).not.toHaveBeenCalled();
    expect(statements).toEqual(['BEGIN', 'INSERT', 'SELECT', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('makes a ladder save of a product that is gone a no-op', async () => {
    const { statements, pool } = goneProductPool();
    const apply = jest.fn();
    const repository = new PriceResearchRepository(pool);

    await expect(repository.saveLadderLocked('w1', 'p1', apply)).resolves.toBeNull();

    expect(apply).not.toHaveBeenCalled();
    expect(statements).toEqual(['BEGIN', 'INSERT', 'SELECT', 'ROLLBACK']);
  });
});
