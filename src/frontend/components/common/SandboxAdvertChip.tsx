// Stands where a live advert would link to OLX: a sandbox advert has no OLX page.
// Same style as the Sandbox chip on listing surfaces.
import React from 'react';
import { Chip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export const SandboxAdvertChip: React.FC<{ sx?: SxProps<Theme> }> = ({ sx }) => (
  <Chip
    component="span"
    size="small"
    color="warning"
    variant="outlined"
    label="Sandbox advert"
    sx={sx}
  />
);
