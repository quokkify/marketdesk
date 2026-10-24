// Branded fallback for a route or page that crashed. It names the failure and offers a hard
// reload and a way back to the dashboard. It is the router's errorElement (a whole page) and,
// through RouteErrorBoundary, the stand-in for a crashed page inside the app shell.
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { APP_NAME } from '../../utils/constants.js';
import { Card } from './Card.js';

export function describeRouteError(error: unknown): string | undefined {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error && error.message) return error.message;
  return undefined;
}

const reloadWindow = () => window.location.reload();

export interface RouteErrorViewProps {
  error?: unknown;
  // True when the view replaces the whole page rather than the content area of the app shell.
  fullPage?: boolean;
  onReload?: () => void;
}

export const RouteErrorView: React.FC<RouteErrorViewProps> = ({
  error,
  fullPage = false,
  onReload = reloadWindow,
}) => {
  const detail = describeRouteError(error);
  return (
    <Box
      role="alert"
      sx={{
        display: 'grid',
        placeItems: 'center',
        minHeight: fullPage ? '100vh' : 360,
        p: 2,
        bgcolor: fullPage ? 'background.default' : undefined,
      }}
    >
      <Card
        sx={{ width: '100%', maxWidth: 440, height: 'auto', textAlign: 'center' }}
        contentSx={{ p: 4, '&:last-child': { pb: 4 } }}
      >
        <Box
          component="img"
          src="/marketdesk-mark.svg"
          alt=""
          aria-hidden="true"
          sx={{
            width: 40,
            height: 40,
            display: 'block',
            mx: 'auto',
            mb: 1.5,
            borderRadius: '50%',
            boxShadow: (theme) => `0 4px 12px ${alpha(theme.palette.primary.main, 0.35)}`,
          }}
        />
        <Typography variant="overline" sx={{ display: 'block', color: 'textMuted' }}>
          {APP_NAME}
        </Typography>
        <Typography variant="h5" component={fullPage ? 'h1' : 'h2'} sx={{ mt: 0.5 }}>
          Something went wrong
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {APP_NAME} could not display this page. Reload to try again, or go back to the dashboard.
        </Typography>
        {detail && (
          <Typography
            variant="caption"
            component="code"
            sx={{
              display: 'block',
              mt: 2,
              color: 'textMuted',
              fontFamily: (theme) => theme.typography.mono,
              wordBreak: 'break-word',
            }}
          >
            {detail}
          </Typography>
        )}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ mt: 3, justifyContent: 'center' }}
        >
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={() => onReload()}>
            Reload
          </Button>
          <Button variant="outlined" color="inherit" component={RouterLink} to="/">
            Back to dashboard
          </Button>
        </Stack>
      </Card>
    </Box>
  );
};

export const RouteError: React.FC = () => {
  const error = useRouteError();
  return <RouteErrorView error={error} fullPage />;
};

export default RouteError;
