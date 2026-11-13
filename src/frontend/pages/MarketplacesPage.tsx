// Marketplaces (PRD §12): the live OLX card and its Configure drawer. The OAuth
// check is the authoritative OLX connection state.
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Skeleton, Stack } from '@mui/material';
import type { Marketplace, MarketplaceKey, SyncMode } from '@shared/types';
import { MARKETPLACE_NAMES } from '@shared/constants';
import type { MarketplaceOAuthStatus, SaveMarketplaceAppCredentialsInput } from '../state/api/index.js';
import {
  useAnalyticsOverview,
  useCheckMarketplace,
  useConnectMarketplace,
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

// OLX is the only live integration (docs/spec/PRODUCT.md); a stored marketplace
// with any other key is ignored, whatever the API reports for it.
const LIVE_MARKETPLACE: MarketplaceKey = 'olx';

const SANDBOX_CONNECTED_TOAST = 'Sandbox OLX connected — no real marketplace calls are made';

// Toast for a completed OLX OAuth return. The wording follows the server's
// check() result alone: a `sandbox` URL param is user input and must never
// turn a real connection into a sandbox claim.
export function oauthReturnToast(status: MarketplaceOAuthStatus): {
  message: string;
  severity: ToastSeverity;
} {
  if (!status.connected) return { message: 'OLX account is not connected.', severity: 'error' };
  if (status.sandbox) return { message: SANDBOX_CONNECTED_TOAST, severity: 'success' };
  return { message: 'OLX account connected.', severity: 'success' };
}

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

const MarketplacesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledOAuthResult = useRef<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useMarketplaces();
  const olx = data?.find((m) => m.key === LIVE_MARKETPLACE);
  const { data: olxCheck } = useMarketplaceConnection(olx?.id ?? '', { skip: !olx });
  const { data: olxOverview } = useAnalyticsOverview({ marketplaceId: olx?.id }, { skip: !olx });
  const { data: olxCredentials } = useMarketplaceAppCredentials(olx?.id ?? '', { skip: !olx });
  const [saveCredentials, { isLoading: savingCredentials }] = useSaveMarketplaceAppCredentials();
  const [syncMarketplace] = useSyncMarketplace();
  const [connectMarketplace] = useConnectMarketplace();
  const [checkMarketplace] = useCheckMarketplace();
  const [updateMarketplace] = useUpdateMarketplace();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // The list view's flag only stands in until the OAuth check answers.
  const olxConnected = olxCheck?.connected ?? olx?.connected ?? false;

  useEffect(() => {
    const oauthResult = searchParams.get('oauth');
    const marketplaceId = searchParams.get('marketplaceId');
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
        dispatch(enqueueToast(oauthReturnToast(status)));
        if (status.connected) void refetch();
      })
      .catch((err: unknown) => {
        dispatch(enqueueToast({ message: errorMessage(err), severity: 'error' }));
      })
      .finally(() => setBusy(false));
  }, [checkMarketplace, dispatch, refetch, searchParams, setSearchParams]);

  const handleSync = async (m: Marketplace) => {
    setSyncing(true);
    try {
      await syncMarketplace(m.id).unwrap();
      dispatch(enqueueToast({ message: `Sync queued for ${marketplaceLabel(m)}.`, severity: 'success' }));
    } catch (err) {
      dispatch(
        enqueueToast({ message: `${marketplaceLabel(m)} sync failed: ${errorMessage(err)}`, severity: 'error' }),
      );
    } finally {
      setSyncing(false);
    }
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
      onSync={handleSync}
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
      {isError && (
        <Card>
          <ErrorRetry compact error={error} title="Marketplaces could not be loaded" onRetry={refetch} />
        </Card>
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
