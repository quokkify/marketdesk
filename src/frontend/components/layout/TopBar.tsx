// Contextual 64px application bar: route identity, global command palette,
// theme, honest notification availability, mobile navigation, and creation.
import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../../state/hooks.js';
import { toggleMobileSidebar, type ResolvedThemeMode } from '../../state/slices/uiSlice.js';
import { useThemeToggle } from '../../theme/useThemeToggle.js';
import { APP_SHELL_CONTENT_INSET, TOPBAR_HEIGHT } from '../../utils/constants.js';
import { CommandPalette, isCommandPaletteShortcut } from './CommandPalette.js';

export interface TopBarRouteMeta {
  title: string;
  subtitle: string;
}

const ROUTE_META: Record<string, TopBarRouteMeta> = {
  '/': {
    title: 'Dashboard',
    subtitle: 'Monitor products, marketplaces, and Hermes work from one command center.',
  },
  '/products': {
    title: 'Products',
    subtitle: 'Manage your catalogue across every marketplace.',
  },
  '/listings': {
    title: 'Listings',
    subtitle: 'Every live and draft listing across connected marketplaces.',
  },
  '/analytics': {
    title: 'Analytics',
    subtitle: 'Performance across marketplaces.',
  },
  '/hermes': {
    title: 'Hermes AI',
    subtitle: 'Everything your AI agent did across monitored listings.',
  },
  '/marketplaces': {
    title: 'Marketplaces',
    subtitle: 'Connect and synchronize sales channels.',
  },
  '/settings': {
    title: 'Settings',
    subtitle: 'Workspace and account preferences.',
  },
};

export function resolveTopBarRoute(pathname: string): TopBarRouteMeta {
  if (pathname === '/products/new' || pathname.startsWith('/products/new/')) {
    return {
      title: 'New product',
      subtitle: 'Create a product and prepare marketplace listings.',
    };
  }
  if (pathname.startsWith('/products/')) {
    return {
      title: 'Product detail',
      subtitle: 'Listing status, pricing, and marketplace activity.',
    };
  }
  return (
    ROUTE_META[pathname] ?? {
      title: 'MarketDesk',
      subtitle: 'Marketplace operations workspace.',
    }
  );
}

export function resolveShortcutHint(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

// PRD icon button: 36px bordered square with radius 10.
const iconButtonSx = {
  width: 36,
  height: 36,
  borderRadius: '10px',
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.secondary',
  '& .MuiSvgIcon-root': { fontSize: 18 },
  '&:hover': { bgcolor: 'surface2' },
  '&.Mui-disabled': { bgcolor: 'background.paper', borderColor: 'divider' },
} as const;

export const ThemeToggleButton: React.FC<{
  resolvedMode: ResolvedThemeMode;
  onToggle: () => void;
}> = ({ resolvedMode, onToggle }) => (
  <Tooltip title={resolvedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
    <IconButton onClick={onToggle} aria-label="Toggle theme" sx={iconButtonSx}>
      {resolvedMode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
    </IconButton>
  </Tooltip>
);

export const TopBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { resolvedMode, toggle: toggleTheme } = useThemeToggle();
  const isMobile = useMediaQuery('(max-width:767.95px)');
  const route = resolveTopBarRoute(location.pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcutHint = resolveShortcutHint(
    typeof navigator === 'undefined' ? '' : navigator.platform
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{
          top: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          bgcolor: (theme) => alpha(theme.palette.background.default, 0.72),
          backdropFilter: 'blur(10px)',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: `${TOPBAR_HEIGHT}px !important`,
            height: TOPBAR_HEIGHT,
            gap: { xs: 1, sm: 1.5, lg: 2 },
            px: { xs: 2, md: `${APP_SHELL_CONTENT_INSET}px` },
          }}
        >
          {isMobile && (
            <IconButton
              onClick={() => dispatch(toggleMobileSidebar())}
              aria-label="Open navigation drawer"
              sx={iconButtonSx}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Box sx={{ minWidth: 0, flexShrink: 1 }}>
            <Typography
              variant="h1"
              noWrap
              sx={{
                fontSize: { xs: '1rem', md: '1.0625rem' },
                lineHeight: 1.1,
                fontWeight: 800,
                letterSpacing: '-0.02em',
              }}
            >
              {route.title}
            </Typography>
            <Typography
              variant="caption"
              noWrap
              sx={{
                display: { xs: 'none', sm: 'block' },
                mt: '2px',
                color: 'textMuted',
                fontSize: '0.75rem',
                maxWidth: { sm: 260, lg: 430 },
              }}
            >
              {route.subtitle}
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search products, listings, and Hermes events"
            aria-keyshortcuts="Meta+K Control+K"
            sx={{
              display: { xs: 'none', md: 'inline-flex' },
              width: { md: 230, lg: 270 },
              minWidth: 0,
              height: 36,
              gap: 1,
              justifyContent: 'flex-start',
              px: 1.5,
              borderRadius: '10px',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'textMuted',
              fontWeight: 500,
              '&:hover': { borderColor: 'borderStrong', bgcolor: 'background.paper' },
            }}
          >
            <SearchRoundedIcon sx={{ fontSize: 17 }} />
            <Typography
              component="span"
              noWrap
              sx={{ flexGrow: 1, textAlign: 'left', fontSize: '0.8125rem' }}
            >
              Search products, listings, events…
            </Typography>
            <Box
              component="kbd"
              sx={{
                px: '6px',
                py: '1px',
                border: 1,
                borderColor: 'divider',
                borderRadius: '6px',
                color: 'textMuted',
                fontFamily: 'inherit',
                fontSize: '0.6875rem',
                fontWeight: 600,
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
              }}
            >
              {shortcutHint}
            </Box>
          </Button>
          <Tooltip title={`Global search (${shortcutHint})`}>
            <IconButton
              onClick={() => setPaletteOpen(true)}
              aria-label="Open global search"
              sx={{ ...iconButtonSx, display: { xs: 'inline-flex', md: 'none' } }}
            >
              <SearchRoundedIcon />
            </IconButton>
          </Tooltip>

          <ThemeToggleButton resolvedMode={resolvedMode} onToggle={toggleTheme} />

          <Tooltip title="Notifications are not available yet">
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <IconButton disabled aria-label="Notifications unavailable" sx={iconButtonSx}>
                <NotificationsNoneOutlinedIcon />
              </IconButton>
            </Box>
          </Tooltip>

          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => navigate('/products?newProduct=1')}
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              height: 36,
              px: 2,
              whiteSpace: 'nowrap',
            }}
          >
            New product
          </Button>
          <Tooltip title="New product">
            <IconButton
              onClick={() => navigate('/products?newProduct=1')}
              aria-label="New product"
              sx={{
                ...iconButtonSx,
                display: { xs: 'inline-flex', sm: 'none' },
                bgcolor: 'primary.main',
                borderColor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              <AddRoundedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
};

export default TopBar;
