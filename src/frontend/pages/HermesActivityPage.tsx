// Hermes activity feed: a banner that states which AI provider answers, stat tiles built
// from endpoints that really exist, and a feed filtered by the server and grown with
// "Load more". Product analysis is launched only from an explicitly selected product.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { HermesEvent, HermesEventStatus, HermesSeverity } from '@shared/types';
import { HERMES_EVENT_STATUS_LIST, HERMES_SEVERITY_LIST } from '@shared/constants';
import {
  useAnalyticsOverview,
  useHermesEventFeed,
  useHermesEvents,
  useHermesStatus,
  useMarketplaces,
} from '../services/hooks/index.js';
import { APP_ROUTE_PATHS } from '../utils/constants.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { HermesStatusBadge, HermesSeverityBadge } from '../components/common/Badge.js';
import { HermesEventCard } from '../components/hermes/index.js';
import {
  HERMES_ACTIONS_SAMPLE_SIZE,
  HERMES_ACTIVITY_TABS,
  buildHermesMetrics,
  flattenHermesFeed,
  hermesEmptyState,
  hermesFeedFilters,
  hermesStatusChip,
  hermesWatching,
} from './hermesActivityState.js';
import type {
  HermesActivityTab,
  HermesMetric,
  HermesStatusChip,
  HermesWatching,
} from './hermesActivityState.js';

const STATUS_LABELS: Record<HermesEventStatus, string> = {
  pending_decision: 'Decision pending',
  pending_review: 'Pending review',
  applying: 'Applying',
  applied: 'Applied',
  dismissed: 'Dismissed',
  failed: 'Action failed',
  reverting: 'Reverting',
  reverted: 'Reverted',
};

const SEVERITY_LABELS: Record<HermesSeverity, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  critical: 'Critical',
};

export const HERMES_SETTINGS_PATH = `${APP_ROUTE_PATHS.settings}?section=hermes`;

// The one literal colour pair of the page: the companion's Hermes banner gradient.
const HERMES_BANNER_FROM = '#5B5BD6';
const HERMES_BANNER_TO = '#A24BD6';
const HERMES_BANNER_GRADIENT = `linear-gradient(135deg, ${HERMES_BANNER_FROM}, ${HERMES_BANNER_TO})`;

const HermesProviderChip: React.FC<{ provider: HermesStatusChip }> = ({ provider }) => {
  const chip = (
    <Chip
      size="small"
      color={provider.color}
      label={provider.label}
      sx={[
        { fontWeight: 700 },
        provider.color === 'default' && {
          bgcolor: (t) => alpha(t.palette.common.white, 0.2),
          color: 'inherit',
        },
      ]}
    />
  );
  return provider.tooltip ? (
    <Tooltip title={provider.tooltip} arrow describeChild>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
};

const HermesWatchingLine: React.FC<{ watching: HermesWatching }> = ({ watching }) => {
  if (watching.kind === 'loading') {
    return (
      <Skeleton
        variant="text"
        width={280}
        sx={{ bgcolor: (t) => alpha(t.palette.common.white, 0.3) }}
      />
    );
  }
  if (watching.kind === 'unavailable') {
    return (
      <Typography variant="body2" sx={{ opacity: 0.92 }}>
        Live listing and marketplace counts could not be loaded.
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Typography variant="body2" sx={{ opacity: 0.92 }}>
        {watching.sentence}
      </Typography>
      {watching.sandbox && (
        <Chip
          size="small"
          label="Sandbox"
          sx={{ bgcolor: (t) => alpha(t.palette.common.white, 0.2), color: 'inherit', fontWeight: 700 }}
        />
      )}
    </Stack>
  );
};

export const HermesHero: React.FC<{
  provider: HermesStatusChip;
  watching: HermesWatching;
  onConfigure: () => void;
  onSelectProduct: () => void;
}> = ({ provider, watching, onConfigure, onSelectProduct }) => (
  <Card
    sx={{
      mb: 2.5,
      border: 'none',
      color: 'common.white',
      background: HERMES_BANNER_GRADIENT,
      boxShadow: (t) => `0 12px 30px ${alpha(t.palette.primary.main, 0.28)}`,
    }}
    contentSx={{ p: { xs: 2.5, md: 3 } }}
  >
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
      >
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 52,
              height: 52,
              flexShrink: 0,
              borderRadius: '14px',
              display: 'grid',
              placeItems: 'center',
              bgcolor: (t) => alpha(t.palette.common.white, 0.2),
            }}
          >
            <AutoAwesomeIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" component="h2" sx={{ fontWeight: 800 }}>
                Hermes AI
              </Typography>
              <HermesProviderChip provider={provider} />
            </Stack>
            <HermesWatchingLine watching={watching} />
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            onClick={onConfigure}
            sx={{
              bgcolor: 'common.white',
              color: HERMES_BANNER_FROM,
              '&:hover': { bgcolor: (t) => alpha(t.palette.common.white, 0.88) },
            }}
          >
            Configure
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<AutoAwesomeIcon />}
            onClick={onSelectProduct}
            sx={{ borderColor: (t) => alpha(t.palette.common.white, 0.55) }}
          >
            Select product to analyze
          </Button>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', opacity: 0.92 }}>
        <InfoOutlinedIcon aria-hidden="true" sx={{ fontSize: 16, mt: '2px' }} />
        <Typography variant="caption">
          Whole-catalogue runs are not started from the UI. Choose a product and use Analyze for
          review-only recommendations.
        </Typography>
      </Stack>
    </Stack>
  </Card>
);

export const HermesMetrics: React.FC<{ metrics: readonly HermesMetric[] }> = ({ metrics }) => (
  <Box
    sx={{
      display: 'grid',
      gap: 2,
      mb: 2.5,
      gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, minmax(0, 1fr))',
        md: 'repeat(4, minmax(0, 1fr))',
      },
    }}
  >
    {metrics.map(({ label, value, caption }) => (
      <Card key={label} contentSx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        {value === null ? (
          <Skeleton variant="text" width="40%" height={44} />
        ) : (
          <Typography variant="h4" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
        )}
        {caption && (
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        )}
      </Card>
    ))}
  </Box>
);

export const HermesFeedFooter: React.FC<{
  loaded: number;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}> = ({ loaded, total, hasMore, loadingMore, onLoadMore }) => (
  <Stack spacing={1} sx={{ alignItems: 'center', mt: 2.5 }}>
    <Typography variant="caption" color="text.secondary">
      {`Showing ${loaded} of ${total}`}
    </Typography>
    {hasMore && (
      <Button variant="outlined" disabled={loadingMore} onClick={onLoadMore}>
        {loadingMore ? 'Loading…' : 'Load more'}
      </Button>
    )}
  </Stack>
);

// Today's tile and the totals come from list queries: the API has no summary endpoint yet.
// Keeping them behind one hook means a summary endpoint replaces only this function.
function useHermesMetrics(): HermesMetric[] {
  const awaitingReview = useHermesEvents({ status: ['pending_review'], limit: 1, sort: '-createdAt' });
  const completed = useHermesEvents({ status: ['applied'], limit: 1, sort: '-createdAt' });
  const dismissed = useHermesEvents({ status: ['dismissed'], limit: 1, sort: '-createdAt' });
  const recent = useHermesEvents({ limit: HERMES_ACTIONS_SAMPLE_SIZE, sort: '-createdAt' });
  return buildHermesMetrics({ awaitingReview, completed, dismissed, recent, now: new Date() });
}

export interface HermesActivityPageProps {
  /** Filters shown first. The route renders the page without props: the All tab and no selects. */
  initialTab?: HermesActivityTab;
  initialStatusFilter?: HermesEventStatus[];
  initialSeverityFilter?: HermesSeverity[];
}

const HermesActivityPage: React.FC<HermesActivityPageProps> = ({
  initialTab = 'all',
  initialStatusFilter = [],
  initialSeverityFilter = [],
}) => {
  const navigate = useNavigate();

  const [activityTab, setActivityTab] = useState<HermesActivityTab>(initialTab);
  const [statusFilter, setStatusFilter] = useState<HermesEventStatus[]>(initialStatusFilter);
  const [severityFilter, setSeverityFilter] = useState<HermesSeverity[]>(initialSeverityFilter);

  const filters = useMemo(
    () => hermesFeedFilters(activityTab, statusFilter, severityFilter),
    [activityTab, statusFilter, severityFilter],
  );
  const feed = useHermesEventFeed(filters);
  // RTK Query keeps the previous filter set's result in `data` and reports `isLoading` false once
  // any data exists, so only `currentData`, the result for this exact filter set, may be shown.
  const { items, total } = flattenHermesFeed(feed.currentData);
  const feedLoading = feed.currentData === undefined && feed.isFetching;

  const status = useHermesStatus();
  const overview = useAnalyticsOverview();
  const marketplaces = useMarketplaces();
  const metrics = useHermesMetrics();

  const handleStatus = (e: SelectChangeEvent<HermesEventStatus[]>) => {
    const value = e.target.value;
    setStatusFilter(typeof value === 'string' ? (value.split(',') as HermesEventStatus[]) : value);
  };

  const handleSeverity = (e: SelectChangeEvent<HermesSeverity[]>) => {
    const value = e.target.value;
    setSeverityFilter(typeof value === 'string' ? (value.split(',') as HermesSeverity[]) : value);
  };

  const emptyState = hermesEmptyState(activityTab, statusFilter.length + severityFilter.length > 0);

  return (
    <Box>
      <HermesHero
        provider={hermesStatusChip(status.data, status)}
        watching={hermesWatching(overview, marketplaces)}
        onConfigure={() => navigate(HERMES_SETTINGS_PATH)}
        onSelectProduct={() => navigate(APP_ROUTE_PATHS.products)}
      />
      <HermesMetrics metrics={metrics} />

      <Card sx={{ mb: 2.5 }} contentSx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { xs: 'stretch', md: 'center' }, justifyContent: 'space-between' }}
        >
          <Tabs
            value={activityTab}
            onChange={(_e, value: HermesActivityTab) => setActivityTab(value)}
            aria-label="Hermes activity"
            variant="scrollable"
            allowScrollButtonsMobile
            slotProps={{ indicator: { sx: { display: 'none' } } }}
            sx={{
              minHeight: 40,
              p: 0.5,
              borderRadius: '12px',
              bgcolor: (t) => alpha(t.palette.text.primary, 0.05),
              '& .MuiTab-root': {
                minHeight: 32,
                py: 0.5,
                px: 1.75,
                borderRadius: '9px',
                fontWeight: 600,
                textTransform: 'none',
              },
              '& .MuiTab-root.Mui-selected': {
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 1,
              },
            }}
          >
            {HERMES_ACTIVITY_TABS.map(({ value, label }) => (
              <Tab key={value} value={value} label={label} />
            ))}
          </Tabs>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            <Select
              size="small"
              multiple
              displayEmpty
              value={statusFilter}
              onChange={handleStatus}
              renderValue={(selected) =>
                selected.length === 0 ? (
                  'All statuses'
                ) : (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {selected.map((s) => (
                      <HermesStatusBadge key={s} status={s} />
                    ))}
                  </Stack>
                )
              }
              sx={{ minWidth: 200 }}
            >
              {HERMES_EVENT_STATUS_LIST.map((s) => (
                <MenuItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              multiple
              displayEmpty
              value={severityFilter}
              onChange={handleSeverity}
              renderValue={(selected) =>
                selected.length === 0 ? (
                  'All severities'
                ) : (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {selected.map((s) => (
                      <HermesSeverityBadge key={s} severity={s} />
                    ))}
                  </Stack>
                )
              }
              sx={{ minWidth: 200 }}
            >
              {HERMES_SEVERITY_LIST.map((s) => (
                <MenuItem key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </MenuItem>
              ))}
            </Select>
          </Stack>
          {(statusFilter.length > 0 || severityFilter.length > 0) && (
            <Button
              size="small"
              onClick={() => {
                setStatusFilter([]);
                setSeverityFilter([]);
              }}
            >
              Clear filters ({statusFilter.length + severityFilter.length})
            </Button>
          )}
        </Stack>
      </Card>

      {feed.isError && items.length === 0 ? (
        <ErrorRetry error={feed.error} onRetry={feed.refetch} />
      ) : feedLoading ? (
        <LoadingSkeleton lines={6} height={112} />
      ) : items.length === 0 ? (
        <EmptyState
          title={emptyState.title}
          description={emptyState.description}
          icon={<AutoAwesomeIcon sx={{ fontSize: 48 }} />}
        />
      ) : (
        <>
          {feed.isError && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => feed.refetch()}>
                  Try again
                </Button>
              }
            >
              The feed could not be refreshed. These events are what was loaded before.
            </Alert>
          )}
          <Stack spacing={2}>
            {items.map((event: HermesEvent) => (
              <HermesEventCard key={event.id} event={event} />
            ))}
          </Stack>
          <HermesFeedFooter
            loaded={items.length}
            total={total}
            hasMore={feed.hasNextPage}
            loadingMore={feed.isFetchingNextPage}
            onLoadMore={() => feed.fetchNextPage()}
          />
        </>
      )}
    </Box>
  );
};

export default HermesActivityPage;
