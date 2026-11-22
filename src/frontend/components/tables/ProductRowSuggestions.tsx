// Pending Hermes suggestions for one catalogue row, reviewed in place under the row.
import React, { useEffect } from 'react';
import { Box, CircularProgress, Stack } from '@mui/material';
import { useHermesEvents } from '../../services/hooks/index.js';
import { HermesEventCard } from '../hermes/HermesEventCard.js';
import { ErrorRetry } from '../common/ErrorRetry.js';
import { isSeoRecommendation } from '../../utils/labels.js';

const PENDING_LIMIT = 20;

export const ProductRowSuggestions: React.FC<{
  productId: string;
  onPendingCountChange: (pending: number) => void;
}> = ({ productId, onPendingCountChange }) => {
  const { currentData, isLoading, isError, error, refetch } = useHermesEvents({
    productId,
    status: ['pending_review'],
    sort: '-createdAt',
    limit: PENDING_LIMIT,
  });
  const events = currentData?.items;
  const pending = events?.length;

  useEffect(() => {
    if (pending !== undefined) onPendingCountChange(pending);
  }, [pending, onPendingCountChange]);

  if (isError) return <ErrorRetry error={error} onRetry={refetch} />;
  if (isLoading || !events) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <CircularProgress size={20} aria-label="Loading suggestions" />
      </Box>
    );
  }
  return (
    <Stack spacing={1.5} aria-label="Pending AI suggestions">
      {events.map((event) => (
        <HermesEventCard
          key={event.id}
          event={event}
          variant={isSeoRecommendation(event) ? 'compactReview' : 'default'}
        />
      ))}
    </Stack>
  );
};

export default ProductRowSuggestions;
