// Daily command center built from real workspace analytics, marketplace, product,
// and Hermes contracts. The global shell owns the page h1, search, and creation CTA.
import React from 'react';
import { Alert, Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmberOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import AnalyticsIcon from '@mui/icons-material/InsightsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import { useNavigate } from 'react-router-dom';
import type { HermesEvent, Marketplace } from '@shared/types';
import {
  useAnalyticsOverview,
  useHermesEvents,
  useListings,
  useMarketplaces,
  useProducts,
  useSyncMarketplace,
} from '../services/hooks/index.js';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import { formatRelative } from '../utils/formatters.js';
import { hermesTypeLabel } from '../utils/labels.js';
import { StatCard } from '../components/common/StatCard.js';
import { Card } from '../components/common/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { LoadingSkeleton } from '../components/common/Skeleton.js';
import { RevenueChart } from '../components/charts/index.js';
import { SeoReviewSummary } from '../components/hermes/index.js';
import { Badge, HermesSeverityBadge, HermesStatusBadge } from '../components/common/Badge.js';
import {
  DASHBOARD_ATTENTION_EMPTY,
  DASHBOARD_ATTENTION_LIMIT,
  DASHBOARD_DELTA_LABEL,
  DASHBOARD_EVENT_LIMIT,
  DASHBOARD_LISTING_SCAN_LIMIT,
  DASHBOARD_QUICK_ACTIONS,
  HERMES_ACTIVITY_SUBTITLE,
  attentionBadgeLabel,
  attentionCount,
  attentionItems,
  attentionOverflowLabel,
  dashboardActivityEvents,
  dashboardKpis,
  dashboardRevenueRange,
  hermesActivityEmptyState,
  hermesSeverityTone,
  isSandboxMarketplace,
  marketplaceDisplayName,
  marketplaceOperationalSummary,
  marketplacePresentation,
  planSyncAll,
  salesChartSummary,
  shouldShowHermesRunning,
  splitDashboardEvents,
  syncAllToast,
} from './dashboardPresentation.js';
import type { AttentionItem, DashboardKpi, DashboardTone } from './dashboardPresentation.js';

// PRD section 18: cards stack in one column below this width and reflow to fewer columns
// until the full layout from the `lg` breakpoint (1200px).
const TABLET_MIN_WIDTH = 768;

const QUICK_ACTION_ICONS = {
  add: <AddIcon fontSize="small" />,
  sync: <SyncIcon fontSize="small" />,
  analyze: <AutoAwesomeIcon fontSize="small" />,
  analytics: <AnalyticsIcon fontSize="small" />,
} satisfies Record<(typeof DASHBOARD_QUICK_ACTIONS)[number]['key'], React.ReactNode>;

const KPI_ICONS = {
  revenue: <PaymentsIcon fontSize="small" />,
  profit: <TrendingUpIcon fontSize="small" />,
  activeListings: <InventoryIcon fontSize="small" />,
  attention: <WarningAmberIcon fontSize="small" />,
} satisfies Record<DashboardKpi['key'], React.ReactNode>;

const focusRing = {
  '&.Mui-focusVisible': {
    outline: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  },
};

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  m: '-1px',
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

const runningPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.35); }
`;

// Every track is minmax(0, ...) so cards shrink instead of overflowing their grid. The tablet
// range stops where the desktop range starts: `sx` emits custom media queries after the standard
// ones, so an open-ended `min-width: 768px` rule would override the desktop columns.
function gridSx(tablet: string, desktop: string, gap = 2.5) {
  return (theme: Theme) => ({
    display: 'grid',
    gap: theme.spacing(gap),
    gridTemplateColumns: 'minmax(0, 1fr)',
    [theme.breakpoints.between(TABLET_MIN_WIDTH, 'lg')]: { gridTemplateColumns: tablet },
    [theme.breakpoints.up('lg')]: { gridTemplateColumns: desktop },
  });
}

function queryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: { message?: string } } }).data;
    if (data?.error?.message) return data.error.message;
  }
  return fallback;
}

const InlineQueryError: React.FC<{
  title: string;
  error: unknown;
  onRetry: () => void;
}> = ({ title, error, onRetry }) => (
  <Alert
    severity="error"
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
    sx={{ alignItems: 'center' }}
  >
    <Typography variant="subtitle2" component="div">
      {title}
    </Typography>
    <Typography variant="caption" component="div">
      {queryErrorMessage(error, 'This dashboard block is temporarily unavailable.')}
    </Typography>
  </Alert>
);

// Square icon tile with a soft theme tint, used for KPI, quick-action and event icons.
const SoftIcon: React.FC<{ tone: DashboardTone; size?: number; children: React.ReactNode }> = ({
  tone,
  size = 36,
  children,
}) => (
  <Box
    aria-hidden
    sx={{
      width: size,
      height: size,
      flexShrink: 0,
      display: 'grid',
      placeItems: 'center',
      borderRadius: '10px',
      color: `${tone}.main`,
      bgcolor: (theme) => alpha(theme.palette[tone].main, 0.12),
    }}
  >
    {children}
  </Box>
);

const KpiValue: React.FC<{ value: string; caption?: string }> = ({ value, caption }) => (
  <>
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Box>
    {caption && (
      <Box
        component="span"
        sx={{
          display: 'block',
          mt: 0.5,
          typography: 'caption',
          fontWeight: 500,
          letterSpacing: 0,
          color: 'text.secondary',
        }}
      >
        {caption}
      </Box>
    )}
  </>
);

// Initials stand-in until the shared marketplace brand chip lands. It is used in one place only,
// so swapping it is a one-line change.
const MarketplaceInitialsChip: React.FC<{ marketplace: Marketplace }> = ({ marketplace }) => (
  <Box
    aria-hidden
    sx={{
      width: 34,
      height: 34,
      flexShrink: 0,
      display: 'grid',
      placeItems: 'center',
      borderRadius: '10px',
      color: 'primary.main',
      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
      typography: 'caption',
      fontWeight: 800,
    }}
  >
    {marketplace.name.slice(0, 2).toUpperCase()}
  </Box>
);

export const MarketplaceRow: React.FC<{ marketplace: Marketplace; onOpen: () => void }> = ({
  marketplace,
  onOpen,
}) => {
  const status = marketplacePresentation(marketplace);
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`Open ${marketplaceDisplayName(marketplace)} marketplace`}
      sx={{
        width: '100%',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: '12px',
        px: 1.5,
        py: 1.25,
        textAlign: 'left',
        '&:hover': { bgcolor: 'action.hover' },
        ...focusRing,
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}
      >
        <MarketplaceInitialsChip marketplace={marketplace} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
              {marketplace.name}
            </Typography>
            {isSandboxMarketplace(marketplace) && (
              <Badge label="Sandbox" color="info" variant="outlined" />
            )}
            <Badge label={status.statusLabel} color={status.statusColor} variant="outlined" />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {marketplaceOperationalSummary(marketplace)}
          </Typography>
        </Box>
        <ChevronRightIcon color="disabled" fontSize="small" />
      </Stack>
    </ButtonBase>
  );
};

const HermesEventRow: React.FC<{ event: HermesEvent; onOpen: () => void }> = ({
  event,
  onOpen,
}) => (
  <ButtonBase
    onClick={onOpen}
    aria-label={`Open Hermes event: ${event.title}`}
    sx={{
      width: '100%',
      textAlign: 'left',
      py: 1.25,
      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
      '&:last-of-type': { borderBottom: 0 },
      ...focusRing,
    }}
  >
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'flex-start', width: '100%', minWidth: 0 }}
    >
      <SoftIcon tone={hermesSeverityTone(event.severity)}>
        <AutoAwesomeIcon fontSize="small" />
      </SoftIcon>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {event.title}
          </Typography>
          <HermesSeverityBadge severity={event.severity} />
          <HermesStatusBadge status={event.status} />
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ display: 'block', mt: 0.25 }}
        >
          {hermesTypeLabel(event.type)}
          {event.detail ? ` · ${event.detail}` : ''}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {formatRelative(event.createdAt)}
      </Typography>
    </Stack>
  </ButtonBase>
);

const RecentEventRow: React.FC<{ event: HermesEvent; onOpen: () => void }> = ({
  event,
  onOpen,
}) => (
  <ButtonBase
    onClick={onOpen}
    aria-label={`Open Hermes event: ${event.title}, ${event.severity} severity`}
    sx={{
      width: '100%',
      textAlign: 'left',
      py: 1,
      borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
      '&:last-of-type': { borderBottom: 0 },
      ...focusRing,
    }}
  >
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: `${hermesSeverityTone(event.severity)}.main`,
        }}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {event.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {hermesTypeLabel(event.type)}
        </Typography>
      </Box>
      <Badge label="Hermes" variant="outlined" />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ flexShrink: 0, minWidth: 72, textAlign: 'right', whiteSpace: 'nowrap' }}
      >
        {formatRelative(event.createdAt)}
      </Typography>
    </Stack>
  </ButtonBase>
);

export const AttentionRow: React.FC<{ item: AttentionItem; onOpen: () => void }> = ({
  item,
  onOpen,
}) => (
  <ButtonBase
    onClick={onOpen}
    aria-label={`Open ${item.title}, ${item.severity}: ${item.reason}`}
    sx={{ width: '100%', textAlign: 'left', py: 1, borderRadius: '10px', ...focusRing }}
  >
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: item.severity === 'critical' ? 'error.main' : 'warning.main',
        }}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {item.title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {item.reason}
        </Typography>
      </Box>
      {item.severity === 'critical' && <HermesSeverityBadge severity="critical" />}
      <ChevronRightIcon color="disabled" fontSize="small" />
    </Stack>
  </ButtonBase>
);

export const QuickActionTile: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
}> = ({ label, icon, onClick, disabled = false, busy = false, hint }) => {
  const hintId = React.useId();
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-describedby={hint ? hintId : undefined}
      sx={{
        minHeight: 96,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: '14px',
        p: 1.5,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexDirection: 'column',
        textAlign: 'left',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        '&.Mui-disabled': { opacity: 0.6 },
        ...focusRing,
      }}
    >
      <SoftIcon tone="primary">{icon}</SoftIcon>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {label}
        </Typography>
        {hint && (
          <Typography
            id={hintId}
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            {hint}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
};

const RunningBadge: React.FC = () => (
  <Stack
    direction="row"
    spacing={0.75}
    sx={{
      alignItems: 'center',
      flexShrink: 0,
      px: 1,
      py: 0.25,
      borderRadius: 999,
      color: 'success.main',
      bgcolor: (theme) => alpha(theme.palette.success.main, 0.12),
    }}
  >
    <Box
      aria-hidden
      sx={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        bgcolor: 'currentColor',
        animation: `${runningPulse} 1.6s ease-in-out infinite`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    />
    <Typography variant="caption" sx={{ fontWeight: 700 }}>
      Running
    </Typography>
  </Stack>
);

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currency = useAppSelector((state) => state.workspace.currency);
  const revenueRange = React.useMemo(() => dashboardRevenueRange(), []);
  // The overview uses the chart's 30-day window so KPI totals match the chart they sit above.
  const overview = useAnalyticsOverview({ from: revenueRange.from, to: revenueRange.to });
  const criticalPending = useHermesEvents({
    status: ['pending_review'],
    severity: ['critical'],
    limit: DASHBOARD_ATTENTION_LIMIT,
    sort: '-createdAt',
  });
  const pendingReview = useHermesEvents({
    status: ['pending_review'],
    limit: 1,
    sort: '-createdAt',
  });
  const recent = useHermesEvents({ limit: DASHBOARD_EVENT_LIMIT, sort: '-createdAt' });
  const activeHermes = useHermesEvents({ status: ['applying', 'reverting'], limit: 1 });
  const attentionProducts = useProducts({
    status: ['attention'],
    limit: DASHBOARD_ATTENTION_LIMIT,
  });
  // Same arguments as the Listings screen, so both share one cache entry.
  const listings = useListings({ sort: '-updatedAt', limit: DASHBOARD_LISTING_SCAN_LIMIT });
  const marketplaces = useMarketplaces();
  const [syncMarketplace] = useSyncMarketplace();
  const [syncing, setSyncing] = React.useState(false);

  const overviewData = overview.isError ? undefined : overview.data;
  const criticalTotal = criticalPending.isError ? undefined : criticalPending.data?.total;
  const kpis = dashboardKpis({
    overview: overviewData,
    criticalPendingTotal: criticalTotal,
    currency,
  });
  const kpiLoading: Record<DashboardKpi['key'], boolean> = {
    revenue: overview.isLoading,
    profit: overview.isLoading,
    activeListings: overview.isLoading,
    attention: overview.isLoading || criticalPending.isLoading,
  };
  const kpiErrors = overview.isError || criticalPending.isError;
  const retryKpis = () => {
    if (overview.isError) void overview.refetch();
    if (criticalPending.isError) void criticalPending.refetch();
  };

  const attentionSources = [overview, criticalPending, attentionProducts, listings];
  const attentionLoading = attentionSources.some((query) => query.isLoading);
  const attentionFailed = attentionSources.find((query) => query.isError);
  const retryAttention = () => {
    attentionSources.forEach((query) => {
      if (query.isError) void query.refetch();
    });
  };
  const attentionTotal = attentionCount(overviewData, criticalTotal);
  const attentionList = React.useMemo(
    () =>
      attentionItems({
        criticalEvents: criticalPending.data?.items ?? [],
        listings: listings.data ?? [],
        attentionProducts: attentionProducts.data?.items ?? [],
      }),
    [criticalPending.data, listings.data, attentionProducts.data]
  );
  const attentionOverflow = attentionOverflowLabel(attentionTotal, attentionList.length);

  const marketplaceRows = marketplaces.data ?? [];
  const noMarketplaceConnected =
    marketplaces.isSuccess && !marketplaceRows.some((marketplace) => marketplace.connected);
  const recentEvents = recent.data?.items ?? [];
  const eventSections = splitDashboardEvents(dashboardActivityEvents(recentEvents));
  const hermesActive = shouldShowHermesRunning(activeHermes.data?.items ?? [], {
    isLoading: activeHermes.isLoading,
    isError: activeHermes.isError,
  });
  const activityEmpty = hermesActivityEmptyState(!noMarketplaceConnected);
  // The empty-state copy depends on the marketplaces, so wait for them only when nothing is listed.
  const activityLoading =
    recent.isLoading || (marketplaces.isLoading && eventSections.latest.length === 0);

  const syncPlan = planSyncAll(marketplaces.isSuccess ? marketplaceRows : undefined);
  const handleSyncAll = async () => {
    if (syncing || syncPlan.targets.length === 0) return;
    setSyncing(true);
    try {
      const outcomes = await Promise.all(
        syncPlan.targets.map(async (marketplace) => {
          try {
            await syncMarketplace(marketplace.id).unwrap();
            return { marketplace };
          } catch (error) {
            return { marketplace, error: queryErrorMessage(error, 'Sync request failed') };
          }
        })
      );
      dispatch(enqueueToast(syncAllToast(outcomes)));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Box
        component="section"
        aria-label="Workspace key performance indicators"
        sx={gridSx('repeat(2, minmax(0, 1fr))', 'repeat(4, minmax(0, 1fr))', 2)}
      >
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.key}
            label={kpi.label}
            value={<KpiValue value={kpi.value} caption={kpi.caption} />}
            deltaPct={kpi.deltaPct}
            deltaLabel={DASHBOARD_DELTA_LABEL}
            icon={<SoftIcon tone={kpi.tone}>{KPI_ICONS[kpi.key]}</SoftIcon>}
            loading={kpiLoading[kpi.key]}
          />
        ))}
      </Box>
      {kpiErrors && (
        <Alert
          severity="error"
          icon={<ErrorOutlineIcon />}
          action={
            <Button color="inherit" size="small" onClick={retryKpis}>
              Retry failed metrics
            </Button>
          }
          sx={{ mt: 1.5 }}
        >
          Some dashboard metrics could not be loaded. Unknown values are shown as —.
        </Alert>
      )}

      <Box sx={[gridSx('minmax(0, 1fr)', 'minmax(0, 62fr) minmax(0, 38fr)'), { mt: 2.5 }]}>
        <Card
          title="Sales overview"
          subtitle="Revenue and profit · last 30 days"
          action={
            <Button size="small" onClick={() => navigate('/analytics')}>
              View analytics
            </Button>
          }
        >
          {!overview.isLoading && (
            <Typography component="p" sx={visuallyHidden}>
              {salesChartSummary(overviewData, currency)}
            </Typography>
          )}
          <RevenueChart params={revenueRange} height={280} />
        </Card>
        <Card
          title="Marketplace overview"
          subtitle="Connection state and synchronization health"
          action={
            <Button size="small" onClick={() => navigate('/marketplaces')}>
              Manage
            </Button>
          }
        >
          {marketplaces.isLoading ? (
            <LoadingSkeleton lines={4} height={58} />
          ) : marketplaces.isError ? (
            <InlineQueryError
              title="Marketplaces failed to load"
              error={marketplaces.error}
              onRetry={() => marketplaces.refetch()}
            />
          ) : marketplaceRows.length === 0 ? (
            <EmptyState
              title="No marketplaces configured"
              description="Connect OLX to begin synchronizing listings."
              action={
                <Button variant="outlined" onClick={() => navigate('/marketplaces')}>
                  Open marketplaces
                </Button>
              }
              compact
            />
          ) : (
            <Stack spacing={1.25}>
              {marketplaceRows.slice(0, 4).map((marketplace) => (
                <MarketplaceRow
                  key={marketplace.id}
                  marketplace={marketplace}
                  onOpen={() => navigate('/marketplaces')}
                />
              ))}
            </Stack>
          )}
        </Card>
      </Box>

      <Box
        sx={[
          gridSx('minmax(0, 1fr)', 'minmax(0, 2fr) minmax(0, 1fr)'),
          { mt: 2.5, alignItems: 'start' },
        ]}
      >
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Card
            sx={{ height: 'auto' }}
            title={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                <SoftIcon tone="primary" size={28}>
                  <AutoAwesomeIcon sx={{ fontSize: 17 }} />
                </SoftIcon>
                <Box
                  component="span"
                  sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  Hermes AI activity
                </Box>
                {hermesActive && <RunningBadge />}
              </Stack>
            }
            subtitle={HERMES_ACTIVITY_SUBTITLE}
            action={
              <Button size="small" onClick={() => navigate('/hermes')}>
                View all
              </Button>
            }
            contentSx={{ pt: 1 }}
          >
            {activityLoading ? (
              <LoadingSkeleton lines={4} height={64} />
            ) : recent.isError ? (
              <InlineQueryError
                title="Hermes activity failed to load"
                error={recent.error}
                onRetry={() => recent.refetch()}
              />
            ) : eventSections.latest.length === 0 ? (
              <EmptyState
                title={activityEmpty.title}
                description={activityEmpty.description}
                action={
                  <Button variant="outlined" onClick={() => navigate(activityEmpty.action.path)}>
                    {activityEmpty.action.label}
                  </Button>
                }
                compact
              />
            ) : (
              <Stack>
                {eventSections.latest.map((event) => (
                  <HermesEventRow key={event.id} event={event} onOpen={() => navigate('/hermes')} />
                ))}
              </Stack>
            )}
          </Card>

          <Card
            title="Recent events"
            subtitle="Earlier Hermes activity in this workspace"
            action={
              <Button size="small" onClick={() => navigate('/hermes')}>
                Open activity
              </Button>
            }
            contentSx={{ pt: 1 }}
            sx={{ height: 'auto' }}
          >
            {recent.isLoading ? (
              <LoadingSkeleton lines={4} height={48} />
            ) : recent.isError ? (
              <InlineQueryError
                title="Recent events failed to load"
                error={recent.error}
                onRetry={() => recent.refetch()}
              />
            ) : eventSections.timeline.length === 0 ? (
              <EmptyState
                title={eventSections.latest.length === 0 ? 'No recent events' : 'No earlier events'}
                description="Hermes workspace activity will appear here."
                compact
              />
            ) : (
              <Stack>
                {eventSections.timeline.map((event) => (
                  <RecentEventRow key={event.id} event={event} onOpen={() => navigate('/hermes')} />
                ))}
              </Stack>
            )}
          </Card>
        </Stack>

        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <Card title="Quick actions" subtitle="Common operator shortcuts" sx={{ height: 'auto' }}>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}
            >
              {DASHBOARD_QUICK_ACTIONS.map((action) =>
                action.kind === 'sync-all' ? (
                  <QuickActionTile
                    key={action.key}
                    label={syncing ? 'Syncing…' : action.label}
                    icon={QUICK_ACTION_ICONS[action.key]}
                    onClick={handleSyncAll}
                    disabled={syncing || syncPlan.targets.length === 0}
                    busy={syncing}
                    hint={syncing ? undefined : syncPlan.disabledReason}
                  />
                ) : (
                  <QuickActionTile
                    key={action.key}
                    label={action.label}
                    icon={QUICK_ACTION_ICONS[action.key]}
                    onClick={() => navigate(action.path)}
                  />
                )
              )}
            </Box>
          </Card>

          <Card
            title="Needs attention"
            subtitle="Products, listings and alerts to review"
            sx={{ height: 'auto' }}
            action={
              attentionTotal !== undefined ? (
                <Badge
                  label={attentionBadgeLabel(attentionTotal)}
                  color={attentionTotal > 0 ? 'warning' : 'default'}
                />
              ) : undefined
            }
          >
            {attentionLoading ? (
              <LoadingSkeleton lines={3} height={44} />
            ) : attentionFailed ? (
              <InlineQueryError
                title="Attention queue failed to load"
                error={attentionFailed.error}
                onRetry={retryAttention}
              />
            ) : attentionList.length === 0 && !attentionOverflow ? (
              <EmptyState
                title={DASHBOARD_ATTENTION_EMPTY.title}
                description={DASHBOARD_ATTENTION_EMPTY.description}
                compact
              />
            ) : (
              <>
                <Stack>
                  {attentionList.map((item) => (
                    <AttentionRow key={item.key} item={item} onOpen={() => navigate(item.path)} />
                  ))}
                </Stack>
                {attentionOverflow && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    {attentionOverflow}
                  </Typography>
                )}
              </>
            )}
          </Card>

          <SeoReviewSummary
            event={pendingReview.data?.items[0]}
            total={pendingReview.data?.total ?? 0}
            loading={pendingReview.isLoading}
            error={pendingReview.isError ? pendingReview.error : undefined}
            onRetry={() => pendingReview.refetch()}
            onReview={(event) =>
              navigate(
                event.productId ? `/products/${encodeURIComponent(event.productId)}` : '/hermes'
              )
            }
            onViewAll={() => navigate('/hermes')}
          />
        </Stack>
      </Box>
    </Box>
  );
};

export default DashboardPage;
