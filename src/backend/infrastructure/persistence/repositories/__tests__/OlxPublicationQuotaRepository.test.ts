import type { Pool } from 'pg';
import { OlxPublicationQuotaRepository } from '../OlxPublicationQuotaRepository';
import { OlxPublicationQuota } from '../../../../domain/entities/OlxPublicationQuota';

const quotaRow = (consumed: number) => ({
  id: 'quota-1',
  workspace_id: 'ws-1',
  marketplace_id: 'mp-1',
  marketplace_account_id: 'account-1',
  subcategory_id: '2000',
  cycle_started_at: new Date('2026-07-01T00:00:00.000Z'),
  cycle_ends_at: new Date('2026-08-01T00:00:00.000Z'),
  publication_limit: 1,
  consumed,
  source: 'operator',
  confidence: 'verified',
  verified_at: new Date('2026-07-14T00:00:00.000Z'),
  stale_at: new Date('2026-07-20T00:00:00.000Z'),
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  updated_at: new Date('2026-07-15T00:00:00.000Z'),
});

describe('OlxPublicationQuotaRepository', () => {
  it('reserves a free unit without consuming it before the publication fence', async () => {
    const statements: string[] = [];
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      statements.push(sql);
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM olx_publication_quotas') && sql.includes('FOR UPDATE')) {
        return { rows: [quotaRow(0)], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const release = jest.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    const repository = new OlxPublicationQuotaRepository(pool);

    const result = await repository.authorize({
      operationId: 'operation-1', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: true,
      overrideReason: 'Operator pre-confirmed paid risk, but a free unit is available', actorId: 'user-1',
    });

    const operationInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO olx_publication_operations'),
    );
    expect(result).toMatchObject({
      decision: 'allow', status: 'available', consumedUnit: false,
      quota: { consumed: 0, remaining: 1 },
    });
    expect(operationInsert?.[1]?.[12]).toBeNull();
    expect(statements.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(statements.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(statements.some((sql) => sql.includes('SET consumed = consumed + 1'))).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('atomically consumes a reservation only after the worker owns the publication fence', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) return { rows: [{
        operation_id: 'operation-1', decision: 'allow', quota_status: 'available',
        reason: 'free_unit_available', consumed_unit: false, quota_id: 'quota-1',
      }], rowCount: 1 };
      if (sql.includes('FROM olx_publication_quotas') && sql.includes('FOR UPDATE')) {
        return { rows: [quotaRow(0)], rowCount: 1 };
      }
      if (sql.includes('UPDATE olx_publication_quotas')) {
        return { rows: [quotaRow(1)], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).consume(
      'operation-1', new Date('2026-07-15T12:00:00.000Z'),
    );

    expect(result).toMatchObject({ decision: 'allow', consumedUnit: true, quota: { consumed: 1 } });
    expect(query.mock.calls.some(([sql]) => sql.includes('SET consumed = consumed + 1'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('uses a monotonic upsert so an in-cycle operator update cannot restore consumed units', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new OlxPublicationQuotaRepository({ query } as unknown as Pool);
    const quota = OlxPublicationQuota.create({
      id: 'quota-1',
      workspaceId: 'ws-1',
      marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1',
      subcategoryId: '2000',
      cycleStartedAt: new Date('2026-07-01T00:00:00.000Z'),
      cycleEndsAt: new Date('2026-08-01T00:00:00.000Z'),
      publicationLimit: 1,
      consumed: 0,
      source: 'operator',
      confidence: 'verified',
      verifiedAt: new Date('2026-07-14T00:00:00.000Z'),
      staleAt: new Date('2026-07-20T00:00:00.000Z'),
    });
    if (quota.isErr()) throw quota.error;

    await repository.save(quota.value);

    expect(String(query.mock.calls[0][0])).toContain(
      'GREATEST(olx_publication_quotas.consumed, EXCLUDED.consumed)',
    );
  });

  it('bounds account quota history in SQL', async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
    const repository = new OlxPublicationQuotaRepository({ query } as unknown as Pool);

    await repository.findByAccount({
      workspaceId: 'ws-1', marketplaceId: 'mp-1', marketplaceAccountId: 'account-1', limit: 100,
    });

    expect(String(query.mock.calls[0][0])).toContain('LIMIT $4');
    expect(query.mock.calls[0][1]).toEqual(['ws-1', 'mp-1', 'account-1', 100]);
  });

  it('persists a block without consuming quota', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FOR UPDATE')) return { rows: [quotaRow(1)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-block', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: false,
    });

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
    expect(result).toMatchObject({ decision: 'block', consumedUnit: false, replayed: false });
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE olx_publication_quotas'))).toBe(false);
    expect(insert?.[1]?.[8]).toBe('block');
    expect(insert?.[1]?.[11]).toBe(false);
  });

  it('persists an explicit override as an unconsumed reservation', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FOR UPDATE')) return { rows: [quotaRow(1)], rowCount: 1 };
      if (sql.includes('UPDATE olx_publication_quotas')) return { rows: [quotaRow(2)], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-override', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: true, overrideReason: 'Operator accepts paid publication', actorId: 'user-1',
    });

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
    expect(result).toMatchObject({ decision: 'override', consumedUnit: false, replayed: false });
    expect(insert?.[1]?.[8]).toBe('override');
    expect(insert?.[1]?.[12]).toBe('Operator accepts paid publication');
  });

  it('re-evaluates a previous non-consuming block instead of replaying it forever', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('FROM olx_publication_operations')) {
        return { rows: [{
          operation_id: 'operation-replay', decision: 'block', quota_status: 'exhausted',
          reason: 'quota_exhausted', consumed_unit: false, quota_id: 'quota-1',
        }], rowCount: 1 };
      }
      if (sql.includes('FROM olx_publication_quotas') && sql.includes('FOR UPDATE')) {
        return { rows: [quotaRow(0)], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;

    const result = await new OlxPublicationQuotaRepository(pool).authorize({
      operationId: 'operation-replay', workspaceId: 'ws-1', marketplaceId: 'mp-1',
      marketplaceAccountId: 'account-1', subcategoryId: '2000',
      at: new Date('2026-07-15T12:00:00.000Z'), listingId: 'listing-1', mode: 'publish',
      overrideConfirmed: false,
    });

    expect(result).toMatchObject({ decision: 'allow', consumedUnit: false, replayed: false });
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('ON CONFLICT (operation_id) DO UPDATE'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  describe('without a quota row', () => {
    const at = new Date('2026-07-15T12:00:00.000Z');
    const writesQuota = (query: jest.Mock) =>
      query.mock.calls.some(([sql]) => /(INSERT INTO|UPDATE) olx_publication_quotas/.test(String(sql)));

    function authorizeWithoutQuota(sandboxMode?: boolean) {
      const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
      const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;
      const result = new OlxPublicationQuotaRepository(pool).authorize({
        operationId: 'operation-sandbox', workspaceId: 'ws-1', marketplaceId: 'mp-1',
        marketplaceAccountId: 'account-1', subcategoryId: '1001', at, listingId: 'listing-1',
        mode: 'publish', overrideConfirmed: false, sandboxMode,
      });
      return { query, result };
    }

    function consumeWithoutQuota(sandboxMode?: boolean) {
      const query = jest.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM olx_publication_operations')) return { rows: [{
          operation_id: 'operation-sandbox', decision: 'allow', quota_status: 'available',
          reason: 'sandbox_unlimited', consumed_unit: false, quota_id: null,
        }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      });
      const pool = { connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;
      const result = new OlxPublicationQuotaRepository(pool).consume('operation-sandbox', at, sandboxMode);
      return { query, result };
    }

    it('records a sandbox allow in the operation ledger without writing quota', async () => {
      const { query, result } = authorizeWithoutQuota(true);

      await expect(result).resolves.toEqual({
        operationId: 'operation-sandbox', decision: 'allow', status: 'available',
        reason: 'sandbox_unlimited', quota: null, consumedUnit: false, replayed: false,
      });
      const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
      expect(insert?.[1]?.[4]).toBeNull();
      expect(insert?.[1]?.slice(8, 12)).toEqual(['allow', 'available', 'sandbox_unlimited', false]);
      expect(writesQuota(query)).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    });

    it('still blocks as quota_unknown outside sandbox mode', async () => {
      const { query, result } = authorizeWithoutQuota();

      await expect(result).resolves.toMatchObject({
        decision: 'block', status: 'unknown', reason: 'quota_unknown', consumedUnit: false,
      });
      const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO olx_publication_operations'));
      expect(insert?.[1]?.slice(8, 11)).toEqual(['block', 'unknown', 'quota_unknown']);
    });

    it('keeps a sandbox allow at consume time without consuming a quota unit', async () => {
      const { query, result } = consumeWithoutQuota(true);

      await expect(result).resolves.toEqual({
        operationId: 'operation-sandbox', decision: 'allow', status: 'available',
        reason: 'sandbox_unlimited', quota: null, consumedUnit: false, replayed: false,
      });
      const update = query.mock.calls.find(([sql]) => sql.includes('UPDATE olx_publication_operations'));
      expect(update?.[1]).toEqual(['operation-sandbox', 'allow', 'available', 'sandbox_unlimited', false]);
      expect(writesQuota(query)).toBe(false);
      expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    });

    it('downgrades an allow to a block at consume time outside sandbox mode', async () => {
      const { result } = consumeWithoutQuota();

      await expect(result).resolves.toMatchObject({
        decision: 'block', status: 'unknown', reason: 'quota_unknown', consumedUnit: false,
      });
    });
  });
});
