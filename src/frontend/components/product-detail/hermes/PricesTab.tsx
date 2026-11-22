// The Market prices tab of the Hermes drawer: the report of the prices Hermes found, a button to
// search again, and "Your prices", the prices the seller found, added and removed here.
import React, { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import type { PriceComparable, PriceResearch, PriceResearchView, StoredPriceEstimate } from '@shared/types';
import { ErrorRetry } from '../../common/ErrorRetry.js';
import { LoadingSkeleton } from '../../common/Skeleton.js';
import {
  useRefreshPriceResearchMutation,
  useSavePriceResearchMutation,
} from '../../../state/api/productsApi.js';
import { currencySymbol, formatMoney } from '../../../utils/formatters.js';
import { requestErrorMessage } from '../revivalView.js';
import {
  MAX_COMPARABLES,
  OLX_CURRENCY,
  OLX_PLN_ONLY,
  classLine,
  discountVsNew,
  hiddenReasonText,
  lastRunText,
  runProgressText,
  storedResearch,
  type PriceResearchBody,
} from '../priceResearchModel.js';
import {
  LIMIT_MESSAGE,
  MY_PRICE_KINDS,
  addMyPrice,
  formAfterSave,
  myPrices,
  removeMyPrice,
  saveFailure,
  type MyPriceKind,
  type MyPriceRow,
  type SaveFailure,
} from './myPricesModel.js';

export const EMPTY_MESSAGE =
  'No market prices yet. Hermes searches for them when you analyze the product, or you can add your own below.';
export const STALE_ESTIMATE_MESSAGE = 'This estimate was made before your last change. Analyze again to update it.';
const NONE_FOUND = 'none found';

const KIND_LABEL = new Map(MY_PRICE_KINDS.map(({ kind, label }) => [kind, label]));

const tileSx = { bgcolor: 'action.hover', borderRadius: 2, p: 1.25, minWidth: 0 } as const;
const listSx = { border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' } as const;
const itemSx = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: 1.5,
  rowGap: 0.25,
  p: 1.25,
  borderBottom: 1,
  borderColor: 'divider',
  '&:last-child': { borderBottom: 0 },
} as const;

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function rangeText(low: number, high: number, currency: string): string {
  const suffix = ` ${currencySymbol(currency)}`;
  return `${formatMoney(low, currency).slice(0, -suffix.length)}–${formatMoney(high, currency)}`;
}

function summaryTiles(stored: StoredPriceEstimate, currency: string): { label: string; value: string }[] {
  const e = stored.estimate;
  return [
    { label: 'Start price', value: formatMoney(e.startPrice, currency) },
    { label: 'Floor', value: formatMoney(e.floorPrice, currency) },
    {
      label: e.retailAnchor ? `New, ${e.retailAnchor.basis}` : 'New',
      value: e.retailAnchor ? formatMoney(e.retailAnchor.amount, currency) : '—',
    },
    {
      label: e.usedRange ? `Used, ${e.usedRange.basis}` : 'Used',
      value: e.usedRange ? rangeText(e.usedRange.low, e.usedRange.high, currency) : '—',
    },
  ];
}

function summarySentence(stored: StoredPriceEstimate): string {
  const e = stored.estimate;
  const percent = e.retailAnchor ? discountVsNew(e.startPrice, e.retailAnchor.amount) : null;
  const parts = [];
  if (percent !== null && percent < 0) parts.push(`${-percent}% below the new price`);
  parts.push(`confidence: ${e.confidence}`);
  return parts.join(' · ');
}

interface FoundRow {
  index: number;
  row: PriceComparable;
}

function foundGroups(research: PriceResearch | null): { kind: MyPriceKind; rows: FoundRow[] }[] {
  const found = (research?.comparables ?? [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.source && row.source !== 'manual');
  return MY_PRICE_KINDS.map(({ kind }) => ({
    kind,
    rows: found.filter(({ row }) => (row.tier ?? 'same_model_used') === kind),
  }));
}

function advertLink(url: string | null | undefined, label: string): React.ReactNode {
  return url && url.startsWith('https://') ? (
    <Link key="link" href={url} target="_blank" rel="noopener noreferrer" variant="caption">{label}</Link>
  ) : null;
}

function joinDots(parts: (React.ReactNode | null | undefined | false)[]): React.ReactNode[] {
  const shown = parts.filter(Boolean);
  return shown.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]));
}

export interface PricesTabProps {
  // Undefined while the research loads.
  view: PriceResearchView | null | undefined;
  error?: unknown;
  onRetry: () => void;
  currency: string;
  listingCurrency: string | null;
  now: Date;
  searching: boolean;
  // Why a search could not start, such as an analysis already running.
  searchMessage: string | null;
  onSearchAgain: () => void;
  onAnalyze: () => void;
  // An analysis is starting or running.
  analyzing: boolean;
  // Why analysis is off, as the Hermes card says it.
  analyzeDisabledReason: string | null;
  // Saves a new research body; rejects with the request error.
  onSave: (body: PriceResearchBody) => Promise<unknown>;
  onReload: () => Promise<unknown> | void;
}

export const PricesTab: React.FC<PricesTabProps> = ({
  view,
  error,
  onRetry,
  currency,
  listingCurrency,
  now,
  searching,
  searchMessage,
  onSearchAgain,
  onAnalyze,
  analyzing,
  analyzeDisabledReason,
  onSave,
  onReload,
}) => {
  const [price, setPrice] = useState('');
  const [kind, setKind] = useState<MyPriceKind>('same_model_used');
  const [url, setUrl] = useState('');
  const [seenAt, setSeenAt] = useState(() => localDate(now));
  const [failure, setFailure] = useState<(SaveFailure & { field?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  if (view === undefined) {
    return error ? <ErrorRetry error={error} onRetry={onRetry} /> : <LoadingSkeleton lines={3} height={48} />;
  }

  const research = storedResearch(view);
  const run = view?.run ?? null;
  const progress = runProgressText(run);
  const active = searching || run !== null;
  const pln = listingCurrency === OLX_CURRENCY;
  const stored = research?.lastEstimate ?? null;
  const groups = foundGroups(research);
  const hasFound = groups.some((g) => g.rows.length > 0);
  const empty = !stored && !hasFound;
  const mine = myPrices(research);
  const atLimit = (research?.comparables.length ?? 0) >= MAX_COMPARABLES && kind !== 'last_new_price';
  const lastRun = lastRunText(view?.lastRun ?? null, view?.nextAutoAt ?? null, now);

  const save = async (body: PriceResearchBody): Promise<boolean> => {
    setSaving(true);
    try {
      await onSave(body);
      return true;
    } catch (err) {
      setFailure(saveFailure(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const typed = { price, kind, url, seenAt };
    const result = addMyPrice(research, typed, currency);
    if (!result.ok) {
      setFailure({ message: result.message, conflict: false, field: result.field });
      return;
    }
    const next = formAfterSave(typed, await save(result.body));
    setPrice(next.price);
    setUrl(next.url);
  };

  const handleRemove = async (index: number | 'retail') => {
    if (!research) return;
    setFailure(null);
    await save(removeMyPrice(research, index));
  };

  const handleReload = async () => {
    await onReload();
    setFailure(null);
  };

  const rowPrice = (row: MyPriceRow) =>
    formatMoney(row.price, row.index === 'retail' ? (research?.retailCurrency ?? currency) : currency);

  return (
    <Stack spacing={3}>
      {empty ? (
        <Stack spacing={1.5} data-testid="prices-summary">
          <Typography variant="body2" color="text.secondary">{EMPTY_MESSAGE}</Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button
              variant="contained"
              disabled={active || analyzing || analyzeDisabledReason !== null}
              onClick={onAnalyze}
              data-testid="prices-analyze"
            >
              Analyze product
            </Button>
            {progress && <Typography variant="body2" color="text.secondary">{progress}</Typography>}
          </Stack>
          {analyzeDisabledReason && (
            <Typography variant="caption" color="text.secondary">{analyzeDisabledReason}</Typography>
          )}
        </Stack>
      ) : (
        <>
          {stored && (
            <Stack spacing={1} data-testid="prices-summary">
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
                {summaryTiles(stored, currency).map((tile) => (
                  <Box key={tile.label} sx={tileSx}>
                    <Typography variant="subtitle2" component="b" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{tile.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{tile.label}</Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">{summarySentence(stored)}</Typography>
              {hiddenReasonText(stored.hiddenReason) && (
                <Typography variant="caption" color="text.secondary" data-testid="prices-hidden-reason">
                  {hiddenReasonText(stored.hiddenReason)}
                </Typography>
              )}
              {stored.researchNote && (
                <Typography variant="caption" color="text.secondary" data-testid="prices-research-note">{stored.researchNote}</Typography>
              )}
              {research && stored.researchUpdatedAt !== research.updatedAt && (
                <Typography variant="caption" color="text.secondary" data-testid="prices-estimate-stale">{STALE_ESTIMATE_MESSAGE}</Typography>
              )}
            </Stack>
          )}

          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" component="h3">Found by Hermes</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {progress && <Typography variant="caption" color="text.secondary" data-testid="prices-progress">{progress}</Typography>}
                <Button
                  variant="outlined"
                  size="small"
                  disabled={!pln || active}
                  startIcon={active ? <CircularProgress size={14} /> : undefined}
                  onClick={onSearchAgain}
                  data-testid="prices-search-again"
                >
                  {active ? 'Searching…' : 'Search again'}
                </Button>
              </Stack>
            </Stack>
            {!pln && <Typography variant="caption" color="text.secondary">{OLX_PLN_ONLY}</Typography>}
            {searchMessage && (
              <Typography variant="caption" color="warning.main" data-testid="prices-search-message">{searchMessage}</Typography>
            )}
            {!progress && lastRun && (
              <Typography variant="caption" color="text.secondary" data-testid="prices-last-run">{lastRun}</Typography>
            )}
            <Box sx={listSx} data-testid="prices-found-list">
              {groups.flatMap(({ kind: tier, rows }) =>
                rows.length === 0
                  ? [
                      <Box key={tier} sx={itemSx} data-testid={`found-tier-${tier}`}>
                        <Typography variant="body2">{KIND_LABEL.get(tier)}</Typography>
                        <Typography variant="body2" color="text.secondary">{NONE_FOUND}</Typography>
                      </Box>,
                    ]
                  : rows.map(({ row, index }) => (
                      <Box key={`${tier}-${index}`} sx={itemSx} data-testid={`found-tier-${tier}`}>
                        <Typography variant="body2">{KIND_LABEL.get(tier)}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>{formatMoney(row.price, currency)}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / 3', overflowWrap: 'anywhere' }}>
                          {joinDots([
                            row.note,
                            classLine(row),
                            row.seenAt ? `seen ${row.seenAt}` : null,
                            advertLink(row.url, 'open'),
                            <Link
                              key="remove"
                              component="button"
                              type="button"
                              variant="caption"
                              disabled={saving}
                              onClick={() => void handleRemove(index)}
                              data-testid={`found-price-remove-${index}`}
                            >
                              remove this advert
                            </Link>,
                          ])}
                        </Typography>
                      </Box>
                    )),
              )}
            </Box>
            {research?.specs && (
              <Box component="details" sx={{ typography: 'caption', color: 'text.secondary' }}>
                <summary>How Hermes matched substitutes</summary>
                <Typography variant="caption" component="p" sx={{ mt: 0.5 }} data-testid="prices-specs">{research.specs}</Typography>
              </Box>
            )}
          </Stack>
        </>
      )}

      <Stack spacing={1}>
        <Typography variant="subtitle2" component="h3">Your prices</Typography>
        <Typography variant="caption" color="text.secondary">
          Prices you found yourself. Hermes uses them and keeps them when it searches again.
        </Typography>
        {mine.length > 0 && (
          <Box sx={listSx} data-testid="my-prices-list">
            {mine.map((row) => (
              <Box key={String(row.index)} sx={itemSx}>
                <Typography variant="body2">
                  {KIND_LABEL.get(row.kind)}
                  <Box component="span" sx={{ ml: 0.75, px: 0.75, py: 0.125, borderRadius: 1, typography: 'caption', fontWeight: 600, bgcolor: 'action.selected' }}>
                    yours
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>{rowPrice(row)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / 3', overflowWrap: 'anywhere' }}>
                  {joinDots([
                    advertLink(row.url, 'link') ?? 'no link',
                    row.seenAt ? `seen ${row.seenAt}` : null,
                    <Link
                      key="remove"
                      component="button"
                      type="button"
                      variant="caption"
                      disabled={saving}
                      onClick={() => void handleRemove(row.index)}
                      data-testid={`my-price-remove-${row.index}`}
                    >
                      remove
                    </Link>,
                  ])}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        <Box
          component="form"
          noValidate
          onSubmit={(event: React.FormEvent) => void handleAdd(event)}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, bgcolor: 'action.hover', borderRadius: 2, p: 1.5 }}
          data-testid="my-price-form"
        >
          <TextField
            size="small"
            label={`Price, ${currencySymbol(currency)}`}
            value={price}
            disabled={atLimit || saving}
            error={failure?.field === 'price'}
            onChange={(event) => setPrice(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'my-price-price' } }}
          />
          <TextField
            select
            size="small"
            label="What it is"
            value={kind}
            onChange={(event) => setKind(event.target.value as MyPriceKind)}
            slotProps={{ select: { native: true }, htmlInput: { 'data-testid': 'my-price-kind' } }}
          >
            {MY_PRICE_KINDS.map(({ kind: value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Link (optional)"
            value={url}
            disabled={atLimit || saving}
            error={failure?.field === 'url'}
            onChange={(event) => setUrl(event.target.value)}
            sx={{ gridColumn: '1 / 3' }}
            slotProps={{ htmlInput: { 'data-testid': 'my-price-url' } }}
          />
          <TextField
            size="small"
            label="Seen on"
            type="date"
            value={seenAt}
            disabled={atLimit || saving}
            error={failure?.field === 'seenAt'}
            onChange={(event) => setSeenAt(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'my-price-seen-at' } }}
          />
          <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button type="submit" variant="contained" disabled={atLimit || saving} data-testid="my-price-add">
              Add price
            </Button>
          </Box>
        </Box>
        {(failure || atLimit) && (
          <Alert severity={failure ? 'error' : 'info'} role="alert" data-testid="my-price-error" action={
            failure?.conflict ? <Button color="inherit" size="small" onClick={() => void handleReload()}>Reload</Button> : undefined
          }>
            {failure ? failure.message : LIMIT_MESSAGE}
          </Alert>
        )}
      </Stack>
    </Stack>
  );
};

export interface PricesTabContainerProps {
  productId: string;
  view: PriceResearchView | null | undefined;
  error?: unknown;
  refetch: () => Promise<unknown>;
  currency: string;
  listingCurrency: string | null;
  onAnalyze: () => void;
  analyzing: boolean;
  analyzeDisabledReason: string | null;
}

// Owns the save and search mutations; the tab itself only renders and calls back.
export const PricesTabContainer: React.FC<PricesTabContainerProps> = ({
  productId,
  view,
  error,
  refetch,
  currency,
  listingCurrency,
  onAnalyze,
  analyzing,
  analyzeDisabledReason,
}) => {
  const [save] = useSavePriceResearchMutation();
  const [refresh, { isLoading: refreshing }] = useRefreshPriceResearchMutation();
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const handleSearchAgain = async () => {
    setSearchMessage(null);
    try {
      await refresh(productId).unwrap();
    } catch (err) {
      // An analysis already running is not a failure: say so next to the button.
      setSearchMessage(requestErrorMessage(err));
    }
  };

  return (
    <PricesTab
      view={view}
      error={error}
      onRetry={() => void refetch()}
      currency={currency}
      listingCurrency={listingCurrency}
      now={new Date()}
      searching={refreshing}
      searchMessage={searchMessage}
      onSearchAgain={() => void handleSearchAgain()}
      onAnalyze={onAnalyze}
      analyzing={analyzing}
      analyzeDisabledReason={analyzeDisabledReason}
      onSave={(body) => save({ productId, body }).unwrap()}
      onReload={refetch}
    />
  );
};
