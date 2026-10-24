// Shown while a marketplace of the workspace runs in the OLX sandbox: the
// engagement numbers come from the sandbox stub, not from OLX traffic.
import React from 'react';
import { Alert } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export const SANDBOX_DATA_NOTICE =
  'Sandbox data: views and watchers are simulated by the OLX sandbox and grow on every sync.';

export const SandboxDataNotice: React.FC<{ sx?: SxProps<Theme> }> = ({ sx }) => (
  <Alert severity="warning" sx={sx}>
    {SANDBOX_DATA_NOTICE}
  </Alert>
);
