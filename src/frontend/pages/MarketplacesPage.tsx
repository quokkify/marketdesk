// Marketplaces (PRD §12): summary bar, the live OLX card, roadmap cards for the
// channels MarketDesk does not integrate yet, and the Configure drawer. The
// OAuth check is the authoritative OLX connection state.
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, Skeleton, Stack, Typography } from '@mui/material';
import type { Marketplace, MarketplaceKey, SyncMode } from '@shared/types';
import { MARKETPLACE_KEY_LIST, MARKETPLACE_NAMES } from '@shared/constants';
import type {
  MarketplaceImportPreview,
  SaveMarketplaceAppCredentialsInput,
} from '../state/api/index.js';
import {
  useAnalyticsOverview,
  useCheckMarketplace,
  useConnectMarketplace,
  useImportMarketplaceAdverts,
  useImportMarketplacePreview,
  useMarketplaceAppCredentials,
  useMarketplaceConnection,
  useMarketplaces,
  useSaveMarketplaceAppCredentials,
  useSyncMarketplace,
  useUpdateMarketplace,
} from '../services/hooks/index.js';
import { useAppDispatch } from '../state/hooks.js';
import { enqueueToast } from '../state/slices/uiSlice.js';
import type { ToastSeverity } from '../state/slices/uiSlice.js';
import { Card } from '../components/common/Card.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorRetry } from '../components/common/ErrorRetry.js';
import { MarketplaceCard } from '../components/marketplaces/MarketplaceCard.js';
import { MarketplaceConfigureDrawer } from '../components/marketplaces/MarketplaceConfigureDrawer.js';
import { MarketplaceSummaryBar } from '../components/marketplaces/MarketplaceSummaryBar.js';
import { RoadmapMarketplaceCard } from '../components/marketplaces/RoadmapMarketplaceCard.js';

// OLX is the only live integration (docs/spec/PRODUCT.md); every other channel
// is a roadmap card, whatever the API reports for it.
const LIVE_MARKETPLACE: MarketplaceKey = 'olx';
const ROADMAP_MARKETPLACES = MARKETPLACE_KEY_LIST.filter((key) => key !== LIVE_MARKETPLACE);

const IMPORT_STATUSES = ['active', 'new', 'moderation', 'limited', 'expired', 'removed', 'rejected'];

export const SANDBOX_CONNECTED_TOAST = 'Sandbox OLX connected — no real marketplace calls are made';

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { error?: { message?: string } }; message?: string };
    return e.data?.error?.message ?? e.message ?? 'Request failed';
  }
  return 'Request failed';
}

function marketplaceLabel(m: Marketplace): string {
  const name = MARKETPLACE_NAMES[m.key];
  return m.sandbox ? `${name} (sandbox)` : name;
}

// The oldest last sync among connected marketplaces; unknown while any of
// them has never synced.
function lastFullSync(marketplaces: Marketplace[]): string | undefined {
  if (marketplaces.length === 0) return undefined;
  let oldest: string | undefined;
  for (const m of marketplaces) {
    if (!m.lastSyncAt) return undefined;
    if (!oldest || Date.parse(m.lastSyncAt) < Date.parse(oldest)) oldest = m.lastSyncAt;
  }
  return oldest;
}

const MarketplacesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledOAuthResult = useRef<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useMarketplaces();
  const olx = data?.find((m) => m.key === LIVE_MARKETPLACE);
  const { data: olxCheck } = useMarketplaceConnection(olx?.id ?? '', { skip: !olx });
  const { data: workspaceOverview } = useAnalyticsOverview();
  const { data: olxOverview } = useAnalyticsOverview({ marketplaceId: olx?.id }, { skip: !olx });
  const { data: olxCredentials } = useMarketplaceAppCredentials(olx?.id ?? '', { skip: !olx });
  const [saveCredentials, { isLoading: savingCredentials }] = useSaveMarketplaceAppCredentials();
  const [syncMarketplace] = useSyncMarketplace();
  const [connectMarketplace] = useConnectMarketplace();
  const [checkMarketplace] = useCheckMarketplace();
  const [importMarketplacePreview] = useImportMarketplacePreview();
  const [importMarketplaceAdverts] = useImportMarketplaceAdverts();
  const [updateMarketplace] = useUpdateMarketplace();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<MarketplaceImportPreview | null>(null);

  // The list view's flag only stands in until the OAuth check answers.
  const olxConnected = olxCheck?.connected ?? olx?.connected ?? false;
  const connectedMarketplaces = olx && olxConnected ? [olx] : [];

  useEffect(() => {
    const oauthResult = searchParams.get('oauth');
    const marketplaceId = searchParams.get('marketplaceId');
    const sandboxReturn = searchParams.get('sandbox') === '1';
    const resultKey = `${oauthResult ?? ''}:${marketplaceId ?? ''}:${searchParams.get('code') ?? ''}`;
    if (!oauthResult || handledOAuthResult.current === resultKey) return;
    handledOAuthResult.current = resultKey;

    const cleanParams = new URLSearchParams(searchParams);
    cleanParams.delete('oauth');
    cleanParams.delete('marketplaceId');
    cleanParams.delete('code');
    cleanParams.delete('sandbox');
    setSearchParams(cleanParams, { replace: true });

    if (oauthResult !== 'success' || !marketplaceId) {
      dispatch(
        enqueueToast({
          message: 'OLX authorization was not completed. Please try again.',
          severity: 'error',
        }),
      );
      return;
    }

    setBusy(true);
    void checkMarketplace(marketplaceId)
      .unwrap()
      .then((status) => {
        if (!status.connected) throw new Error('OLX account is not connected');
        dispatch(
          enqueueToast({
            message: sandboxReturn || status.sandbox ? SANDBOX_CONNECTED_TOAST : 'OLX account connected.',
            severity: 'success',
          }),
        );
        void refetch();
      })
      .catch((err: unknown) => {
        dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
      })
      .finally(() => setBusy(false));
  }, [checkMarketplace, dispatch, refetch, searchParams, setSearchParams]);

  const handleSyncAll = async () => {
    if (connectedMarketplaces.length === 0) return;
    setSyncing(true);
    const results = await Promise.allSettled(
      connectedMarketplaces.map((m) => syncMarketplace(m.id).unwrap()),
    );
    setSyncing(false);
    const queued: string[] = [];
    const failed: string[] = [];
    results.forEach((result, index) => {
      const label = marketplaceLabel(connectedMarketplaces[index]);
      if (result.status === 'fulfilled') queued.push(label);
      else failed.push(`${label} sync failed: ${errorMessage(result.reason)}`);
    });
    const message = [queued.length > 0 ? `Sync queued for ${queued.join(', ')}.` : null, ...failed]
      .filter(Boolean)
      .join(' ');
    const severity: ToastSeverity = failed.length === 0 ? 'success' : queued.length > 0 ? 'warning' : 'error';
    dispatch(enqueueToast({ message, severity }));
  };

  const handleConnect = async (m: Marketplace) => {
    setBusy(true);
    try {
      const oauth = await connectMarketplace({ id: m.id }).unwrap();
      window.location.assign(oauth.authorizationUrl);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!olx) return;
    setBusy(true);
    try {
      await updateMarketplace({ id: olx.id, patch: { connected: false } }).unwrap();
      setDisconnectOpen(false);
      setConfigureOpen(false);
      dispatch(
        enqueueToast({
          message: `${marketplaceLabel(olx)} disconnected. Listings stay in MarketDesk.`,
          severity: 'success',
        }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusy(false);
    }
  };

  const handleSyncModeChange = async (m: Marketplace, syncMode: SyncMode) => {
    try {
      await updateMarketplace({ id: m.id, patch: { syncMode } }).unwrap();
      dispatch(
        enqueueToast({ message: `${marketplaceLabel(m)} sync mode updated.`, severity: 'success' }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    }
  };

  const handleSaveCredentials = async (input: SaveMarketplaceAppCredentialsInput): Promise<boolean> => {
    if (!olx) return false;
    try {
      await saveCredentials({ id: olx.id, input }).unwrap();
      dispatch(enqueueToast({ message: 'OLX application credentials saved.', severity: 'success' }));
      return true;
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
      return false;
    }
  };

  const handleImportPreview = async (m: Marketplace) => {
    setBusy(true);
    try {
      const preview = await importMarketplacePreview({ id: m.id, statuses: IMPORT_STATUSES }).unwrap();
      setImportPreview(preview);
      dispatch(
        enqueueToast({
          message: `OLX preview found ${preview.totals.discovered} advert(s).`,
          severity: 'success',
        }),
      );
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusy(false);
    }
  };

  const handleImportAllEligible = async () => {
    if (!importPreview) return;
    const eligibleIds = importPreview.items
      .filter((item) => item.status === 'new' || item.status === 'changed')
      .map((item) => item.externalListingId);
    if (eligibleIds.length === 0) {
      dispatch(enqueueToast({ message: 'No eligible OLX adverts to import.', severity: 'info' }));
      return;
    }
    setBusy(true);
    try {
      const result = await importMarketplaceAdverts({
        id: importPreview.marketplaceId,
        externalListingIds: eligibleIds,
      }).unwrap();
      dispatch(
        enqueueToast({
          message: `Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`,
          severity: result.failed > 0 ? 'warning' : 'success',
        }),
      );
      void refetch();
      setImportPreview(null);
    } catch (err) {
      dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
    } finally {
      setBusy(false);
    }
  };

  const olxSlot = isLoading ? (
    <Skeleton variant="rounded" height={300} />
  ) : isError ? null : olx ? (
    <MarketplaceCard
      marketplace={olx}
      connected={olxConnected}
      liveListingCount={olxOverview?.liveListingCount ?? null}
      syncing={syncing}
      busy={busy}
      credentialsMissing={!olx.sandbox && olxCredentials?.configured === false}
      onConnect={handleConnect}
      onRequestDisconnect={() => setDisconnectOpen(true)}
      onConfigure={() => setConfigureOpen(true)}
      onImportPreview={handleImportPreview}
    />
  ) : (
    <Card>
      <EmptyState
        compact
        title="OLX is not set up"
        description="Marketplace channels will appear here once your workspace is provisioned."
      />
    </Card>
  );

  return (
    <Stack spacing={2.5}>
      {isError ? (
        <Card>
          <ErrorRetry compact error={error} title="Marketplaces could not be loaded" onRetry={refetch} />
        </Card>
      ) : isLoading ? (
        <Skeleton variant="rounded" height={80} />
      ) : (
        <MarketplaceSummaryBar
          connectedCount={connectedMarketplaces.length}
          totalCount={MARKETPLACE_KEY_LIST.length}
          liveListingCount={workspaceOverview?.liveListingCount ?? null}
          lastFullSyncAt={lastFullSync(connectedMarketplaces)}
          sandbox={Boolean(olx?.sandbox)}
          syncing={syncing}
          onSyncAll={handleSyncAll}
        />
      )}

      {importPreview && (
        <Alert severity="info">
          <Stack spacing={1}>
            <Typography variant="subtitle2">Read-only OLX import preview</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={`Discovered: ${importPreview.totals.discovered}`} />
              <Chip size="small" color="success" label={`New: ${importPreview.totals.new}`} />
              <Chip size="small" color="info" label={`Changed: ${importPreview.totals.changed}`} />
              <Chip size="small" label={`Already imported: ${importPreview.totals.already_imported}`} />
              <Chip size="small" color="warning" label={`Unsupported: ${importPreview.totals.unsupported}`} />
              <Chip size="small" color="error" label={`Failed: ${importPreview.totals.failed}`} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                disabled={busy || importPreview.totals.new + importPreview.totals.changed === 0}
                onClick={handleImportAllEligible}
              >
                Import eligible OLX adverts
              </Button>
              <Button size="small" variant="text" onClick={() => setImportPreview(null)}>
                Dismiss preview
              </Button>
            </Stack>
            {importPreview.items.slice(0, 5).map((item) => (
              <Typography key={item.externalListingId} variant="body2">
                {item.title} — {item.status}
                {item.remoteStatus ? ` (${item.remoteStatus})` : ''}
                {item.warnings.length > 0 ? ` · ${item.warnings.join(', ')}` : ''}
              </Typography>
            ))}
            {importPreview.items.length > 5 && (
              <Typography variant="body2" color="text.secondary">
                Showing first 5 of {importPreview.items.length} adverts.
              </Typography>
            )}
          </Stack>
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        {olxSlot}
        {ROADMAP_MARKETPLACES.map((key) => (
          <RoadmapMarketplaceCard key={key} marketplaceKey={key} />
        ))}
      </Box>

      {olx && (
        <>
          <MarketplaceConfigureDrawer
            open={configureOpen}
            marketplace={olx}
            connected={olxConnected}
            busy={busy}
            credentials={olxCredentials}
            savingCredentials={savingCredentials}
            onClose={() => setConfigureOpen(false)}
            onSyncModeChange={handleSyncModeChange}
            onSaveCredentials={handleSaveCredentials}
            onRequestDisconnect={() => setDisconnectOpen(true)}
          />
          <ConfirmDialog
            open={disconnectOpen}
            title={olx.sandbox ? 'Disconnect sandbox OLX?' : 'Disconnect OLX?'}
            message="MarketDesk removes the stored OLX authorization and stops syncing. Your listings stay in MarketDesk and nothing is removed from OLX. You can reconnect at any time."
            confirmLabel="Disconnect"
            confirmColor="error"
            loading={busy}
            onConfirm={handleDisconnect}
            onCancel={() => setDisconnectOpen(false)}
          />
        </>
      )}
    </Stack>
  );
};

export default MarketplacesPage;
