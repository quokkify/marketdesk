import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import type { Marketplace, SyncMode } from '@shared/types';
import type { MarketplaceAppCredentialStatus } from '../../state/api/index.js';
import { Badge } from '../common/Badge';
import { MarketplaceConfigureDrawer, OlxAppCredentialsForm } from './MarketplaceConfigureDrawer';
import type { MarketplaceConfigureDrawerProps } from './MarketplaceConfigureDrawer';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    sandbox: false,
    syncMode: 'manual',
    lastSyncAt: undefined,
    errorCount: 0,
    capacity: 100,
    createdAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function credentials(
  overrides: Partial<MarketplaceAppCredentialStatus> = {},
): MarketplaceAppCredentialStatus {
  return { configured: false, marketplaceId: 'marketplace-olx', providerKey: 'olx', ...overrides };
}

function drawerProps(
  overrides: Partial<Marketplace> = {},
  props: Partial<MarketplaceConfigureDrawerProps> = {},
): MarketplaceConfigureDrawerProps {
  return {
    open: true,
    marketplace: marketplace(overrides),
    connected: true,
    busy: false,
    credentials: credentials(),
    savingCredentials: false,
    onClose: jest.fn(),
    onSyncModeChange: jest.fn(),
    onSaveCredentials: jest.fn(() => Promise.resolve(true)),
    onRequestDisconnect: jest.fn(),
    ...props,
  };
}

function renderTree(props: MarketplaceConfigureDrawerProps): ElementLike {
  return MarketplaceConfigureDrawer(props) as ElementLike;
}

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement) as ElementLike[];
}

function findByType(element: ElementLike, type: unknown): ElementLike[] {
  const direct = element.type === type ? [element] : [];
  return [...direct, ...childrenOf(element).flatMap((child) => findByType(child, type))];
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (React.isValidElement(node)) return textContent((node as ElementLike).props.children);
  return '';
}

describe('MarketplaceConfigureDrawer', () => {
  it('labels sync mode, explains modes, and hides unsupported realtime selection', () => {
    const tree = renderTree(drawerProps({ syncMode: 'hourly' }));
    const labels = findByType(tree, InputLabel);
    const selects = findByType(tree, Select);
    const options = findByType(tree, MenuItem);
    const helpers = findByType(tree, FormHelperText);

    expect(labels.map((label) => textContent(label))).toContain('Sync mode');
    expect(selects[0]?.props.value).toBe('hourly');
    expect(options.map((option) => option.props.value)).toEqual(['manual', 'hourly']);
    expect(helpers.map((helper) => textContent(helper))).toContain(
      'Run automatic synchronization once per hour.',
    );
  });

  it('keeps unsupported realtime visible but disabled if returned by the API', () => {
    const tree = renderTree(drawerProps({ syncMode: 'realtime' as SyncMode }));
    const realtime = findByType(tree, MenuItem).find((option) => option.props.value === 'realtime');
    const helpers = findByType(tree, FormHelperText);

    expect(realtime?.props.disabled).toBe(true);
    expect(helpers.map((helper) => textContent(helper))).toContain(
      'Real-time sync is not available for the current OLX integration yet.',
    );
  });

  it('reports a new sync mode and keeps the select disabled until connected', () => {
    const props = drawerProps();
    const [select] = findByType(renderTree(props), Select);
    const [disconnectedControl] = findByType(renderTree(drawerProps({}, { connected: false })), FormControl);

    (select?.props.onChange as (event: { target: { value: SyncMode } }) => void)({
      target: { value: 'hourly' },
    });
    expect(props.onSyncModeChange).toHaveBeenCalledWith(props.marketplace, 'hourly');
    expect(disconnectedControl?.props.disabled).toBe(true);
  });

  it('hosts the OLX app credentials form', () => {
    const props = drawerProps({ sandbox: true });
    const [form] = findByType(renderTree(props), OlxAppCredentialsForm);

    expect(form?.props).toMatchObject({
      sandbox: true,
      connected: true,
      credentials: props.credentials,
      saving: false,
      onSave: props.onSaveCredentials,
    });
  });

  it('labels sandbox mode in the drawer header', () => {
    const sandboxBadges = findByType(renderTree(drawerProps({ sandbox: true })), Badge);
    const realBadges = findByType(renderTree(drawerProps()), Badge);

    expect(sandboxBadges.map((badge) => badge.props.label)).toContain('Sandbox');
    expect(realBadges.map((badge) => badge.props.label)).not.toContain('Sandbox');
  });

  it('offers Disconnect only while connected and leaves the confirmation to the page', () => {
    const props = drawerProps();
    const disconnect = findByType(renderTree(props), Button).find(
      (button) => textContent(button) === 'Disconnect OLX',
    );
    const whileDisconnected = findByType(renderTree(drawerProps({}, { connected: false })), Button).map(
      (button) => textContent(button),
    );

    (disconnect?.props.onClick as () => void)();
    expect(props.onRequestDisconnect).toHaveBeenCalledWith(props.marketplace);
    expect(whileDisconnected).not.toContain('Disconnect OLX');
  });

  it('closes from the header close button and from the backdrop or Escape', () => {
    const props = drawerProps();
    const tree = renderTree(props);
    const close = findByType(tree, IconButton).find(
      (button) => button.props['aria-label'] === 'Close configuration',
    );

    (close?.props.onClick as () => void)();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(tree.props.onClose).toBe(props.onClose);
  });
});

describe('OlxAppCredentialsForm', () => {
  function renderForm(props: Partial<React.ComponentProps<typeof OlxAppCredentialsForm>> = {}): string {
    return renderToStaticMarkup(
      <OlxAppCredentialsForm
        sandbox={false}
        connected={false}
        credentials={credentials()}
        saving={false}
        onSave={jest.fn(() => Promise.resolve(true))}
        {...props}
      />,
    );
  }

  it('says credentials are not needed in sandbox mode and keeps the fields collapsed', () => {
    const html = renderForm({ sandbox: true });

    expect(html).toContain('Not needed in sandbox mode');
    expect(html).toContain('Show credential fields');
    expect(html).toContain('MuiCollapse-hidden');
    expect(html).toContain('Client ID');
  });

  it('shows the credential fields outside sandbox mode', () => {
    const html = renderForm();

    expect(html).not.toContain('Not needed in sandbox mode');
    expect(html).not.toContain('MuiCollapse-hidden');
    expect(html).toContain('Client ID');
    expect(html).toContain('Save OLX app credentials');
  });

  it('warns that saving new credentials disconnects the connected account', () => {
    const html = renderForm({ connected: true, credentials: credentials({ configured: true, clientId: 'client-1' }) });

    expect(html).toContain('Saving new credentials disconnects the current OLX account.');
    expect(html).toContain('Update OLX app credentials');
  });
});
