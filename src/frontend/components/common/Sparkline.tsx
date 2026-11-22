// A tiny single-colour trend line without axes, for table cells.
import React from 'react';
import { useTheme } from '@mui/material/styles';
import { sparklinePoints } from '../../pages/productsCatalogueState.js';

const DEFAULT_WIDTH = 70;
const DEFAULT_HEIGHT = 18;
const STROKE_WIDTH = 1.6;

export const Sparkline: React.FC<{
  values: readonly number[];
  width?: number;
  height?: number;
}> = ({ values, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }) => {
  const theme = useTheme();
  const points = sparklinePoints(values, width, height);
  if (!points) return null;
  return (
    <svg
      width={width}
      height={height + STROKE_WIDTH * 2}
      viewBox={`0 ${-STROKE_WIDTH} ${width} ${height + STROKE_WIDTH * 2}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={theme.palette.success.main}
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default Sparkline;
