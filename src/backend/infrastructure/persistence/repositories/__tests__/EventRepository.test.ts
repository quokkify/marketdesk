// SQL contract of EventRepository for the provider source of AI-made events. The
// round trip against a real database lives in repositories.integration.test.ts.

import type { Pool, PoolClient } from 'pg';
import { EventRepository } from '../EventRepository';
import { HermesEvent } from '../../../../domain/entities/HermesEvent';
import { unwrap } from '../../../../domain/testkit/support';
import type { AgentRecommendationRecord } from '../../../../domain/agents/MarketDeskAgentCatalog';

function offlineTitleEvent(): HermesEvent {
  return unwrap(
    HermesEvent.create({
      id: 'event-1',
      workspaceId: 'workspace-1',
      productId: 'product-1',
      type: 'suggested_better_title',
      severity: 'info',
      title: 'Improve product title for search',
      detail: 'Camera - Good condition. Heuristic offline suggestion; Hermes was not consulted.',
      proposedChange: { kind: 'title', field: 'title', from: 'Camera', to: 'Camera - Good condition' },
      source: 'offline',
    }),
  );
}

function fakeQuery(rows: unknown[] = []) {
  return jest.fn(async () => ({ rows, rowCount: 1 }));
}

// The value bound to the `source` column of an INSERT statement.
function boundSource(sql: string, values: unknown[]): unknown {
  const columns = sql
    .match(/INSERT INTO hermes_events\s*\(([^)]*)\)/)?.[1]
    ?.split(',')
    .map((column) => column.trim());
  const index = columns?.indexOf('source') ?? -1;
  return index >= 0 ? values[index] : 'no source column';
}

describe('EventRepository provider source', () => {
  it('stores the source of a saved event', async () => {
    const query = fakeQuery();
    const repository = new EventRepository({ query } as unknown as Pool);

    await repository.save(offlineTitleEvent());

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(boundSource(sql, values)).toBe('offline');
  });

  it('stores the source of an idempotent recommendation', async () => {
    const query = fakeQuery();
    const repository = new EventRepository({ query } as unknown as Pool);

    await repository.saveRecommendationIfAbsent(offlineTitleEvent(), 'key-1');

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(boundSource(sql, values)).toBe('offline');
  });

  it('stores the source of an agent recommendation event', async () => {
    const query = fakeQuery();
    const repository = new EventRepository(undefined, { query } as unknown as PoolClient);
    const recommendation: AgentRecommendationRecord = {
      id: 'recommendation-1',
      workspaceId: 'workspace-1',
      productId: 'product-1',
      eventId: 'event-1',
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: 'a'.repeat(64),
      recommendationFingerprint: 'b'.repeat(64),
      outcome: 'suggested',
      suggestedAt: new Date('2026-10-24T08:00:00.000Z'),
    };

    await repository.saveAgentRecommendationIfAbsent(offlineTitleEvent(), 'key-1', recommendation);

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(boundSource(sql, values)).toBe('offline');
  });

  it('reads the source back', async () => {
    const query = fakeQuery([
      {
        id: 'event-1',
        workspace_id: 'workspace-1',
        product_id: 'product-1',
        type: 'suggested_better_title',
        severity: 'info',
        status: 'pending_review',
        title: 'Improve product title for search',
        detail: 'Camera - Good condition. Heuristic offline suggestion; Hermes was not consulted.',
        proposed_change: { kind: 'title', field: 'title', from: 'Camera', to: 'Camera - Good condition' },
        autonomy_decision: 'pending_review',
        created_at: '2026-10-24T08:00:00.000Z',
        resolved_at: null,
        source: 'offline',
      },
    ]);
    const repository = new EventRepository({ query } as unknown as Pool);

    const event = await repository.findById('event-1');

    expect((query.mock.calls[0] as unknown as [string])[0]).toMatch(/\bsource\b/);
    expect(event?.source).toBe('offline');
  });
});
