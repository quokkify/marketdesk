// Frontend UI constants (navigation, layout dimensions).
// Domain constants live in @shared/constants — reuse those, don't duplicate.
import type { SvgIconComponent } from '@mui/icons-material';
import DashboardIcon from '@mui/icons-material/GridViewOutlined';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined';
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';

export interface NavItem {
  label: string;
  path: string;
  icon: SvgIconComponent;
}

// Canonical router paths. Keeping deep-link-only routes here makes route
// registration independently testable from primary navigation membership.
export const APP_ROUTE_PATHS = {
  login: '/login',
  products: '/products',
  productDetail: '/products/:productId',
  listings: '/listings',
  analytics: '/analytics',
  hermes: '/hermes',
  marketplaces: '/marketplaces',
  settings: '/settings',
} as const;

// Order matches PRD §4. Listings remain routable for deep links but are managed
// contextually under Products rather than occupying a second primary destination.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardIcon },
  { label: 'Products', path: APP_ROUTE_PATHS.products, icon: InventoryIcon },
  { label: 'Analytics', path: APP_ROUTE_PATHS.analytics, icon: InsightsIcon },
  { label: 'Hermes AI', path: APP_ROUTE_PATHS.hermes, icon: AutoAwesomeIcon },
  { label: 'Marketplaces', path: APP_ROUTE_PATHS.marketplaces, icon: StorefrontIcon },
  { label: 'Settings', path: APP_ROUTE_PATHS.settings, icon: SettingsIcon },
];

export const SIDEBAR_WIDTH = 250;
export const SIDEBAR_COLLAPSED_WIDTH = 76;
export const TOPBAR_HEIGHT = 64;
export const APP_SHELL_CONTENT_INSET = 32;

export const APP_NAME = 'MarketDesk';
