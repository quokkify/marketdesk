// Canonical MarketDesk navigation: mobile drawer, automatic medium rail, and
// user-collapsible wide desktop sidebar with an edge-straddling affordance.
// Geometry and colours follow the PRD shell (250px sidebar, primary-weak
// active item, danger pill for pending Hermes reviews, account card).
import React from 'react';
import {
  Avatar,
  Badge,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../state/hooks.js';
import { useGetHermesEventsQuery } from '../../state/api/index.js';
import { setMobileSidebarOpen, toggleSidebar } from '../../state/slices/uiSlice.js';
import { logout } from '../../state/slices/authSlice.js';
import {
  NAV_ITEMS,
  SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  APP_NAME,
} from '../../utils/constants.js';

export type SidebarResponsiveMode = 'mobile' | 'medium' | 'desktop';

export function resolveSidebarResponsiveMode(width: number): SidebarResponsiveMode {
  if (width < 768) return 'mobile';
  if (width < 1200) return 'medium';
  return 'desktop';
}

export function isPrimaryNavActive(current: string, target: string): boolean {
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}

const avatarGradient = (t: Theme) =>
  `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`;

export const Sidebar: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery('(max-width:767.95px)');
  const isMedium = useMediaQuery('(min-width:768px) and (max-width:1199.95px)');
  const collapsed = useAppSelector((state) => state.ui.sidebarCollapsed);
  const mobileOpen = useAppSelector((state) => state.ui.sidebarMobileOpen);
  const workspaceName = useAppSelector((state) => state.workspace.name);
  const user = useAppSelector((state) => state.auth.user);
  const pendingReviews = useGetHermesEventsQuery({
    status: ['pending_review'],
    limit: 1,
    offset: 0,
  });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountMenuAnchor, setAccountMenuAnchor] = React.useState<HTMLElement | null>(null);

  const showLabels = isMobile || (!isMedium && !collapsed);
  const width = showLabels ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
  const primaryItems = NAV_ITEMS.filter((item) => item.path !== '/settings');
  const settingsItem = NAV_ITEMS.find((item) => item.path === '/settings');
  const userLabel = user?.email ?? 'Account';
  const workspaceLabel = workspaceName || 'Workspace loading';
  const avatarLetter = (user?.email ?? workspaceName ?? 'U').charAt(0).toUpperCase();
  const pendingReviewCount = pendingReviews.currentData?.total;

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) dispatch(setMobileSidebarOpen(false));
  };

  const handleAccountMenuClose = () => setAccountMenuAnchor(null);

  const handleAccountNavigate = () => {
    handleAccountMenuClose();
    handleNavigate('/settings');
  };

  const handleSignOut = () => {
    handleAccountMenuClose();
    if (isMobile) dispatch(setMobileSidebarOpen(false));
    dispatch(logout());
  };

  const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isPrimaryNavActive(location.pathname, item.path);
    const pendingCount = item.path === '/hermes' && pendingReviewCount ? pendingReviewCount : 0;
    const Icon = item.icon;
    const pendingLabel = pendingCount
      ? `, ${pendingCount} pending ${pendingCount === 1 ? 'review' : 'reviews'}`
      : '';
    const button = (
      <ListItemButton
        key={item.path}
        selected={active}
        onClick={() => handleNavigate(item.path)}
        aria-label={`${item.label}${pendingLabel}`}
        aria-current={active ? 'page' : undefined}
        sx={{
          flexGrow: 0,
          minHeight: 40,
          gap: showLabels ? '11px' : 0,
          px: showLabels ? '11px' : 1,
          py: '9px',
          borderRadius: '11px',
          justifyContent: showLabels ? 'flex-start' : 'center',
          color: 'text.secondary',
          '&:hover': { bgcolor: 'surface2' },
          '&.Mui-selected': {
            bgcolor: 'primary.weak',
            color: 'primary.main',
            '&:hover': { bgcolor: 'primary.weak' },
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 0, color: 'inherit', justifyContent: 'center' }}>
          <Badge
            color="error"
            badgeContent={pendingCount}
            max={99}
            invisible={showLabels || !pendingCount}
            overlap="circular"
          >
            <Icon fontSize="small" />
          </Badge>
        </ListItemIcon>
        {showLabels && (
          <ListItemText
            primary={item.label}
            sx={{ my: 0 }}
            slotProps={{
              primary: { sx: { fontSize: '0.84375rem', fontWeight: active ? 700 : 600 } },
            }}
          />
        )}
        {showLabels && pendingCount > 0 && (
          <Box
            component="span"
            sx={{
              px: '7px',
              borderRadius: '20px',
              bgcolor: 'error.weak',
              color: 'error.main',
              fontSize: '0.6875rem',
              fontWeight: 700,
              lineHeight: '18px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {pendingCount > 99 ? '99+' : pendingCount}
          </Box>
        )}
      </ListItemButton>
    );
    return showLabels ? (
      button
    ) : (
      <Tooltip key={item.path} title={`${item.label}${pendingLabel}`} placement="right">
        {button}
      </Tooltip>
    );
  };

  const content = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        px: showLabels ? '14px' : 1,
        py: '18px',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: showLabels ? 'flex-start' : 'center',
          gap: '11px',
          px: showLabels ? 1 : 0,
          pt: '6px',
          pb: '20px',
          flexShrink: 0,
        }}
      >
        <Box
          component="img"
          src="/marketdesk-mark.svg"
          alt=""
          aria-hidden="true"
          sx={{
            width: 34,
            height: 34,
            display: 'block',
            flexShrink: 0,
            borderRadius: '50%',
            boxShadow: (t) => `0 4px 12px ${alpha(t.palette.primary.main, 0.35)}`,
          }}
        />
        {showLabels && (
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                fontSize: '0.96875rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {APP_NAME}
            </Typography>
            <Typography
              variant="overline"
              noWrap
              sx={{
                display: 'block',
                mt: '3px',
                color: 'textMuted',
                fontWeight: 600,
                letterSpacing: '0.04em',
                lineHeight: 1.2,
              }}
            >
              Marketplace OS
            </Typography>
          </Box>
        )}
      </Box>

      {showLabels && (
        <Typography
          variant="overline"
          component="div"
          sx={{ px: '10px', pt: '6px', pb: 1, color: 'textMuted' }}
        >
          Menu
        </Typography>
      )}
      <List
        component="nav"
        aria-label="Primary navigation"
        disablePadding
        sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flexGrow: 1 }}
      >
        {primaryItems.map(renderNavItem)}
      </List>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
        {settingsItem && renderNavItem(settingsItem)}
        {showLabels ? (
          <Box
            component="button"
            type="button"
            onClick={(event) => setAccountMenuAnchor(event.currentTarget)}
            aria-label={`${workspaceLabel} · ${userLabel}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(accountMenuAnchor)}
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              mt: '12px',
              p: '13px',
              borderRadius: '14px',
              bgcolor: 'surface2',
              border: 1,
              borderColor: 'divider',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              transition: theme.transitions.create('border-color'),
              '&:hover': { borderColor: 'borderStrong' },
              '&:focus-visible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 2,
              },
            }}
          >
            <Avatar
              sx={{
                width: 34,
                height: 34,
                flexShrink: 0,
                background: avatarGradient,
                color: 'common.white',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {avatarLetter}
            </Avatar>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Tooltip title={workspaceLabel} placement="top-start">
                <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 700 }}>
                  {workspaceLabel}
                </Typography>
              </Tooltip>
              <Tooltip title={userLabel} placement="top-start">
                <Typography noWrap sx={{ fontSize: '0.6875rem', color: 'textMuted' }}>
                  {userLabel}
                </Typography>
              </Tooltip>
            </Box>
            <UnfoldMoreRoundedIcon aria-hidden="true" sx={{ fontSize: 16, color: 'textMuted' }} />
          </Box>
        ) : (
          <Tooltip title={`${workspaceName || 'Workspace'} · ${userLabel}`} placement="right">
            <ListItemButton
              onClick={(event) => setAccountMenuAnchor(event.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={Boolean(accountMenuAnchor)}
              sx={{ justifyContent: 'center', px: 1, mt: '12px' }}
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  background: avatarGradient,
                  color: 'common.white',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {avatarLetter}
              </Avatar>
            </ListItemButton>
          </Tooltip>
        )}
      </Box>
      <Menu
        anchorEl={accountMenuAnchor}
        open={Boolean(accountMenuAnchor)}
        onClose={handleAccountMenuClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem onClick={handleAccountNavigate}>Workspace settings</MenuItem>
        <MenuItem onClick={handleSignOut}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </Box>
  );

  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => dispatch(setMobileSidebarOpen(false))}
        ModalProps={{ keepMounted: true }}
        sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        '& .MuiDrawer-paper': {
          width,
          position: 'sticky',
          top: 0,
          height: '100vh',
          boxSizing: 'border-box',
          overflow: 'visible',
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        },
      }}
      open
    >
      {content}
      {!isMedium && (
        <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
          <IconButton
            size="small"
            onClick={() => dispatch(toggleSidebar())}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            sx={{
              position: 'absolute',
              top: '50%',
              right: -15,
              transform: 'translateY(-50%)',
              width: 30,
              height: 30,
              zIndex: 1,
              borderRadius: '50%',
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'text.secondary',
              boxShadow: 1,
              opacity: 0.48,
              transition: theme.transitions.create(['opacity', 'box-shadow', 'color']),
              '&:hover, &:focus-visible': {
                opacity: 1,
                color: 'primary.main',
                boxShadow: 3,
                bgcolor: 'background.paper',
              },
            }}
          >
            {collapsed ? (
              <ChevronRightRoundedIcon fontSize="small" />
            ) : (
              <ChevronLeftRoundedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      )}
    </Drawer>
  );
};

export default Sidebar;
