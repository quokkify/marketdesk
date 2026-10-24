import {
  useAnalyticsListings,
  useAnalyticsOverview,
  useAnalyticsRevenue,
  useHermesEvents,
  useListings,
  useProducts,
} from './index';
import {
  useGetAnalyticsListingsQuery,
  useGetAnalyticsOverviewQuery,
  useGetAnalyticsRevenueQuery,
  useGetHermesEventsQuery,
  useGetListingsQuery,
  useGetProductsQuery,
} from '../../state/api/index.js';

jest.mock('../../state/hooks.js', () => ({
  useAppSelector: (selector: (state: { workspace: { id: string } }) => unknown) =>
    selector({ workspace: { id: 'ws-1' } }),
}));

jest.mock('../../state/api/index.js', () => ({
  useGetAnalyticsListingsQuery: jest.fn(),
  useGetAnalyticsOverviewQuery: jest.fn(),
  useGetAnalyticsRevenueQuery: jest.fn(),
  useGetHermesEventsQuery: jest.fn(),
  useGetListingsQuery: jest.fn(),
  useGetProductsQuery: jest.fn(),
}));

describe('workspace-scoped query hooks', () => {
  it('scope each query to the active workspace and forward its options', () => {
    const options = { skip: true };

    useProducts({ limit: 5 }, options);
    useListings({ limit: 5 }, options);
    useHermesEvents({ limit: 5 }, options);
    useAnalyticsOverview({ from: '2026-01-01' }, options);
    useAnalyticsRevenue({ from: '2026-01-01' }, options);
    useAnalyticsListings({ from: '2026-01-01' }, options);

    const scoped = { workspaceId: 'ws-1' };
    expect(useGetProductsQuery).toHaveBeenCalledWith({ ...scoped, limit: 5 }, options);
    expect(useGetListingsQuery).toHaveBeenCalledWith({ ...scoped, limit: 5 }, options);
    expect(useGetHermesEventsQuery).toHaveBeenCalledWith({ ...scoped, limit: 5 }, options);
    expect(useGetAnalyticsOverviewQuery).toHaveBeenCalledWith(
      { ...scoped, from: '2026-01-01' },
      options
    );
    expect(useGetAnalyticsRevenueQuery).toHaveBeenCalledWith(
      { ...scoped, from: '2026-01-01' },
      options
    );
    expect(useGetAnalyticsListingsQuery).toHaveBeenCalledWith(
      { ...scoped, from: '2026-01-01' },
      options
    );
  });
});
