// Redis Streams-based event broker. Appends domain events to per-aggregate
// streams via XADD. The Redis dependency is behind a minimal injectable
// interface so the broker is unit-testable without a live Redis; a default
// factory wires the real client from config/redis.

import type { DomainEvent } from '../../domain/ports/IEventPublisher';

// Only the slice of the Redis client the broker needs.
export interface RedisStreamClient {
  xadd(key: string, id: string, ...args: string[]): Promise<string | null>;
}

// Generic broker abstraction the EventPublisher depends on. Keeps the publisher
// decoupled from the transport (Redis Streams here, but swappable).
export interface EventBroker {
  publish(event: DomainEvent): Promise<string>;
}

export interface RedisEventBrokerOptions {
  streamPrefix?: string;
}

export class RedisEventBroker implements EventBroker {
  private readonly streamPrefix: string;

  constructor(
    private readonly redis: RedisStreamClient,
    options: RedisEventBrokerOptions = {},
  ) {
    this.streamPrefix = options.streamPrefix ?? 'hermes:events:';
  }

  // Append the event to its aggregate stream. Returns the generated stream entry id.
  async publish(event: DomainEvent): Promise<string> {
    const stream = `${this.streamPrefix}${event.aggregateType}`;
    const id = await this.redis.xadd(
      stream,
      '*',
      'type',
      event.type,
      'aggregateType',
      event.aggregateType,
      'aggregateId',
      event.aggregateId,
      'payload',
      JSON.stringify(event.payload),
      'occurredAt',
      event.occurredAt.toISOString(),
    );
    return id ?? '';
  }
}

// NOTE: the default wiring that binds this broker to the real Redis client
// (config/redis) lives in ./RedisWiring.ts so this module stays free of any
// connection/config import and is trivially unit-testable.
