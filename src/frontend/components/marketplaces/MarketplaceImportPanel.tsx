// Read-only preview of the adverts already live on OLX, with one action that
// imports the new and changed ones into MarketDesk. Nothing here writes to OLX.
import React from 'react';
import { Alert, Button, Chip, Stack, Typography } from '@mui/material';
import type {
  MarketplaceImportPreview,
  MarketplaceImportPreviewItem,
} from '../../state/api/index.js';

export interface MarketplaceImportPanelProps {
  preview: MarketplaceImportPreview;
  busy: boolean;
  onImport: () => void;
  onClose: () => void;
}

export function importableCount(preview: MarketplaceImportPreview): number {
  return preview.totals.new + preview.totals.changed;
}

function itemLine(item: MarketplaceImportPreviewItem): string {
  const remote = item.remoteStatus ? ` (${item.remoteStatus})` : '';
  const warnings = item.warnings.length > 0 ? ` · ${item.warnings.join(', ')}` : '';
  return `${item.title} — ${item.status}${remote}${warnings}`;
}

export const MarketplaceImportPanel: React.FC<MarketplaceImportPanelProps> = ({
  preview,
  busy,
  onImport,
  onClose,
}) => {
  const { totals } = preview;
  return (
    <Alert severity="info">
      <Stack spacing={1}>
        <Typography variant="subtitle2">Adverts found on OLX</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" label={`Discovered: ${totals.discovered}`} />
          <Chip size="small" color="success" label={`New: ${totals.new}`} />
          <Chip size="small" color="info" label={`Changed: ${totals.changed}`} />
          <Chip size="small" label={`Already imported: ${totals.already_imported}`} />
          <Chip size="small" color="warning" label={`Unsupported: ${totals.unsupported}`} />
          <Chip size="small" color="error" label={`Failed: ${totals.failed}`} />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            disabled={busy || importableCount(preview) === 0}
            onClick={onImport}
          >
            Import new and changed
          </Button>
          <Button size="small" variant="text" onClick={onClose}>
            Close
          </Button>
        </Stack>
        {preview.items.map((item) => (
          <Typography key={item.externalListingId} variant="body2">
            {itemLine(item)}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
};
