// The price research of a product as the page reads it, and the product price with its discount
// against a new one. The research is edited in the Market prices tab of the Hermes drawer.
import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { skipToken } from '@reduxjs/toolkit/query';
import { productsApi, useGetPriceResearchQuery } from '../../state/api/productsApi.js';
import { baseApi } from '../../state/api/baseApi.js';
import { useAppDispatch } from '../../state/hooks.js';
import { discountLine, storedResearch } from './priceResearchModel.js';
import { formatMoney } from '../../utils/formatters.js';

const POLL_INTERVAL_MS = 5000;

// The price research of a product. It polls while a market search runs, and when the search ends
// it reads again what the search changed. The rail and the drawer both follow it.
export function usePriceResearchView(productId: string) {
  const dispatch = useAppDispatch();
  const arg = productId || skipToken;
  const cached = productsApi.endpoints.getPriceResearch.useQueryState(arg).currentData;
  const query = useGetPriceResearchQuery(arg, { pollingInterval: cached?.run ? POLL_INTERVAL_MS : 0 });
  const active = Boolean(query.currentData?.run);
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) {
      dispatch(baseApi.util.invalidateTags([{ type: 'PriceResearch', id: productId }, { type: 'HermesEvent', id: 'LIST' }]));
    }
    wasActive.current = active;
  }, [active, dispatch, productId]);
  return query;
}

export interface PriceResearchSectionProps {
  productId: string;
  currentPrice: number;
  currency: string;
}

// The product price with its discount against a new one, shown in the product's header.
export const ProductPriceDiscount: React.FC<PriceResearchSectionProps> = ({ productId, currentPrice, currency }) => {
  const research = storedResearch(useGetPriceResearchQuery(productId).currentData);
  const discount = research ? discountLine(currentPrice, research, currency) : null;
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{formatMoney(currentPrice, currency)}</Typography>
      {discount && (
        <Typography variant="body2" color="text.secondary" data-testid="product-price-discount">
          {discount}
        </Typography>
      )}
    </Box>
  );
};
