import type { Listing } from '@shared/types';
import {
  PENDING_PUBLICATION_POLL_INTERVAL_MS,
  PENDING_PUBLICATION_TIMEOUT_MS,
  createPendingPublicationPoller,
} from './pendingPublicationPolling';
import type { PendingPublicationStop } from './pendingPublicationPolling';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'l1',
    productId: 'p1',
    marketplaceId: 'm1',
    price: 100,
    status: 'draft',
    views: null,
    watchers: null,
    conversations: null,
    messages: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    updatedAt: '2026-11-13T10:00:00.000Z',
    ...overrides,
  };
}

function poller() {
  const refetch = jest.fn();
  const stops: PendingPublicationStop[] = [];
  const instance = createPendingPublicationPoller({ refetch, onStop: (stop) => stops.push(stop) });
  return { refetch, stops, instance };
}

describe('createPendingPublicationPoller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('refetches every 5000 ms: three calls after 15 seconds', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    jest.advanceTimersByTime(15000);

    expect(PENDING_PUBLICATION_POLL_INTERVAL_MS).toBe(5000);
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(stops).toEqual([]);
    instance.dispose();
  });

  it('keeps polling while the listing is still a draft without a failure', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    instance.observe(listing());
    jest.advanceTimersByTime(10000);

    expect(refetch).toHaveBeenCalledTimes(2);
    expect(stops).toEqual([]);
    instance.dispose();
  });

  it('stops once the listing is live', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    jest.advanceTimersByTime(5000);
    instance.observe(listing({ status: 'live' }));
    jest.advanceTimersByTime(30000);

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(stops).toEqual([{ kind: 'settled' }]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops and reports the failure text the listings table shows', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    jest.advanceTimersByTime(5000);
    instance.observe(listing({ status: 'error', syncError: 'OLX rejected the advert: missing city.' }));
    jest.advanceTimersByTime(30000);

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(stops).toEqual([{ kind: 'failed', message: 'OLX rejected the advert: missing city.' }]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a timeout after 120 seconds and stops refetching', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    jest.advanceTimersByTime(PENDING_PUBLICATION_TIMEOUT_MS - 1);
    expect(stops).toEqual([]);
    jest.advanceTimersByTime(1);

    expect(PENDING_PUBLICATION_TIMEOUT_MS).toBe(120000);
    expect(stops).toEqual([{ kind: 'timed_out' }]);
    const calls = refetch.mock.calls.length;
    jest.advanceTimersByTime(30000);
    expect(refetch).toHaveBeenCalledTimes(calls);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves no timers behind when disposed, as on unmount', () => {
    const { refetch, stops, instance } = poller();

    instance.start();
    jest.advanceTimersByTime(5000);
    instance.dispose();
    jest.advanceTimersByTime(PENDING_PUBLICATION_TIMEOUT_MS);

    expect(jest.getTimerCount()).toBe(0);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(stops).toEqual([]);
  });

  it('ignores observations before start and after it stopped', () => {
    const { stops, instance } = poller();

    instance.observe(listing({ status: 'live' }));
    expect(stops).toEqual([]);

    instance.start();
    instance.observe(listing({ status: 'live' }));
    instance.observe(listing({ status: 'error', syncError: 'Late failure.' }));

    expect(stops).toEqual([{ kind: 'settled' }]);
  });
});
