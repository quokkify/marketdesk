// The Suggestions tab of the Hermes drawer: this product's pending suggestions, reviewed one by one.
import React from 'react';
import { Stack, Typography } from '@mui/material';
import type { HermesEvent } from '@shared/types';
import { ErrorRetry } from '../../common/ErrorRetry.js';
import { LoadingSkeleton } from '../../common/Skeleton.js';
import { SeoRecommendationQueue } from '../../hermes/index.js';

export interface SuggestionsTabProps {
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  events: HermesEvent[];
  total: number;
  onResolved: () => void;
  onViewAll: () => void;
  successMessage: (event: HermesEvent) => string | undefined;
}

export const SuggestionsTab: React.FC<SuggestionsTabProps> = ({
  loading,
  error,
  onRetry,
  events,
  total,
  onResolved,
  onViewAll,
  successMessage,
}) =>
  loading ? (
    <LoadingSkeleton lines={2} height={96} />
  ) : error ? (
    <ErrorRetry error={error} onRetry={onRetry} />
  ) : events.length === 0 ? (
    <Typography variant="body2" color="text.secondary">
      No pending recommendations for this product.
    </Typography>
  ) : (
    <Stack spacing={1.5}>
      <SeoRecommendationQueue
        events={events}
        total={total}
        onResolved={onResolved}
        onViewAll={onViewAll}
        approveLabel="Apply"
        successMessage={successMessage}
      />
      <Typography variant="caption" color="text.secondary">
        Category correction always uses separate audited delist and recreate reviews.
      </Typography>
    </Stack>
  );
