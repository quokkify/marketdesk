// Default Redis wiring for the infrastructure layer. This is the ONE place that
// imports the shared Redis client from config/redis; the broker/publisher
// classes themselves take injected clients so they stay unit-testable. Group 6
// DI uses these factories (or injects its own clients).

import type { Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis';
import {
  RedisEventBroker,
  RedisEventBrokerOptions,
  RedisStreamClient,
  EventBroker,
} from './RedisEventBroker';
import { EventPublisher } from './EventPublisher';

// Wire the broker to the real Redis client. The adapter object narrows ioredis's
// heavily-overloaded xadd down to the RedisStreamClient shape.
export function createRedisEventBroker(
  redis?: Redis,
  options?: RedisEventBrokerOptions,
): RedisEventBroker {
  const client = redis ?? createRedisClient();
  const streamClient: RedisStreamClient = {
    xadd: (key, id, ...args) => client.xadd(key, id, ...args),
  };
  return new RedisEventBroker(streamClient, options);
}

// Default publisher: emit to Redis Streams.
export function createEventPublisher(broker?: EventBroker): EventPublisher {
  return new EventPublisher(broker ?? createRedisEventBroker());
}
