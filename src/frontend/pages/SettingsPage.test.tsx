import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Button, Typography } from '@mui/material';
import { alpha, ThemeProvider, type Theme } from '@mui/material/styles';
import type { IntegrationSettingsStatus } from '@shared/types';
import { lightTheme } from '../theme/lightTheme';
import { withoutStyleTags } from '../testkit/staticMarkup';
import {
  ApplicationInfoBlock,
  mapSettingsFieldErrors,
  densityOptions,
  MarketplaceAccountsList,
  marketplaceAccountStatus,
  SettingsSectionNavigation,
  shouldHydrateWorkspaceDraft,
  workspaceSettingsPatch,
  settingsSections,
  settingsSectionFromHash,
  settingsSectionFromLocation,
  settingsSectionPath,
  themeModeOptions,
  type SettingsSection,
} from './SettingsPage';

type ElementLike = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function childrenOf(element: ElementLike): ElementLike[] {
  return React.Children.toArray(element.props.children).filter(
    React.isValidElement
  ) as ElementLike[];
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

function render(node: React.ReactNode): string {
  return withoutStyleTags(
    renderToStaticMarkup(
      <ThemeProvider theme={lightTheme}>
        <MemoryRouter>{node}</MemoryRouter>
      </ThemeProvider>
    )
  );
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function marketplaceItem(
  overrides: Partial<IntegrationSettingsStatus> = {}
): IntegrationSettingsStatus {
  return {
    category: 'marketplace',
    id: 'marketplace-olx',
    providerKey: 'olx',
    name: 'OLX',
    available: true,
    configured: true,
    connected: true,
    account: { handle: 'seller@example.test', status: 'connected' },
    sandbox: false,
    ...overrides,
  };
}

describe('SettingsPage shell navigation', () => {
  it('offers four sections', () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      'general',
      'marketplaces',
      'appearance',
      'about',
    ]);
  });

  it.each(['hermes', 'notifications', 'apiKeys', 'telegram', 'security'])(
    'opens General for the removed section %s',
    (section) => {
      expect(settingsSectionFromLocation({ search: `?section=${section}`, hash: '' })).toBe(
        'general'
      );
      expect(settingsSectionFromHash(`#${section}`)).toBe('general');
    }
  );

  it('opens the requested settings section from ?section= and falls back to the legacy hash', () => {
    expect(settingsSectionFromLocation({ search: '?section=marketplaces', hash: '' })).toBe(
      'marketplaces'
    );
    expect(settingsSectionFromLocation({ search: '', hash: '#appearance' })).toBe('appearance');
    expect(
      settingsSectionFromLocation({ search: '?section=marketplaces', hash: '#appearance' })
    ).toBe('marketplaces');
    expect(settingsSectionFromLocation({ search: '?section=bogus', hash: '#appearance' })).toBe(
      'appearance'
    );
    expect(settingsSectionFromLocation({ search: '?section=bogus', hash: '' })).toBe('general');
    expect(settingsSectionFromLocation({ search: '', hash: '' })).toBe('general');
  });

  it('keeps hash parsing and builds ?section= paths', () => {
    expect(settingsSectionFromHash('#appearance')).toBe('appearance');
    expect(settingsSectionFromHash('#unknown')).toBe('general');
    expect(settingsSectionPath('appearance')).toBe('/settings?section=appearance');
  });

  it('shows section titles only and marks General as the default active section', () => {
    const tree = SettingsSectionNavigation({
      activeSection: 'general',
      onSectionChange: jest.fn(),
    }) as ElementLike;

    const buttons = findByType(tree, Button);

    expect(buttons.map((button) => textContent(button))).toEqual(
      settingsSections.map((section) => section.label)
    );
    expect(findByType(tree, Typography)).toHaveLength(0);
    expect(buttons[0]?.props['aria-current']).toBe('page');
    expect(buttons[1]?.props['aria-current']).toBeUndefined();
  });

  it('tints the active item with the primary palette and leaves others transparent', () => {
    const tree = SettingsSectionNavigation({
      activeSection: 'appearance',
      onSectionChange: jest.fn(),
    }) as ElementLike;
    const styleFor = (label: string) => {
      const button = findByType(tree, Button).find((candidate) => textContent(candidate) === label);
      return (button?.props.sx as (theme: Theme) => Record<string, unknown>)(lightTheme);
    };

    expect(styleFor('Appearance')).toMatchObject({
      bgcolor: alpha(lightTheme.palette.primary.main, 0.12),
      color: lightTheme.palette.primary.main,
    });
    expect(styleFor('General')).toMatchObject({
      bgcolor: 'transparent',
      color: lightTheme.palette.text.secondary,
    });
  });

  it('invokes navigation updates for another representative section', () => {
    const onSectionChange = jest.fn<void, [SettingsSection]>();
    const tree = SettingsSectionNavigation({
      activeSection: 'general',
      onSectionChange,
    }) as ElementLike;

    const appearanceButton = findByType(tree, Button).find((button) =>
      textContent(button).includes('Appearance')
    );
    appearanceButton?.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onSectionChange).toHaveBeenCalledWith('appearance');
  });

  it('moves the current-page marker when Appearance becomes the selected section', () => {
    const tree = SettingsSectionNavigation({
      activeSection: 'appearance',
      onSectionChange: jest.fn(),
    }) as ElementLike;

    const current = findByType(tree, Button).filter(
      (button) => button.props['aria-current'] === 'page'
    );

    expect(current.map((button) => textContent(button))).toEqual(['Appearance']);
  });

  it('shows the installed release version in the About block', () => {
    const tree = ApplicationInfoBlock({ version: 'v0.10.0' }) as ElementLike;

    expect(textContent(tree)).toContain('Application version');
    expect(textContent(tree)).toContain('v0.10.0');
    expect(textContent(tree)).not.toMatch(/commit|sha|branch|dirty/i);
  });

  it('shows an honest fallback when application information cannot be loaded', () => {
    const tree = ApplicationInfoBlock({ isError: true }) as ElementLike;

    expect(textContent(tree)).toContain('Version unavailable');
  });

  it('preserves a dirty workspace draft on refetch but hydrates a changed principal', () => {
    expect(
      shouldHydrateWorkspaceDraft({
        initializedPrincipal: 'workspace:user-a',
        principalKey: 'workspace:user-a',
        baselineSnapshot: 'old',
        incomingSnapshot: 'new',
        dirty: true,
      })
    ).toBe(false);
    expect(
      shouldHydrateWorkspaceDraft({
        initializedPrincipal: 'workspace:user-a',
        principalKey: 'workspace:user-b',
        baselineSnapshot: 'old',
        incomingSnapshot: 'new',
        dirty: true,
      })
    ).toBe(true);
  });

  it('maps backend validation details to General field errors', () => {
    expect(
      mapSettingsFieldErrors({
        data: {
          error: {
            details: [
              { field: 'timezone', message: 'Invalid IANA timezone' },
              { field: 'unknown', message: 'ignored' },
            ],
          },
        },
      })
    ).toEqual({ timezone: 'Invalid IANA timezone' });
  });

  it('sends only fields changed from the current principal baseline', () => {
    const baseline = {
      name: 'Old name',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      language: 'en' as const,
    };
    const staleDraft = { ...baseline, name: 'New name' };

    expect(workspaceSettingsPatch(baseline, staleDraft)).toEqual({ name: 'New name' });
  });
});

describe('marketplaceAccountStatus', () => {
  it('follows the marketplace row connection flag', () => {
    expect(marketplaceAccountStatus(marketplaceItem())).toBe('connected');
    expect(marketplaceAccountStatus(marketplaceItem({ connected: false, account: null }))).toBe(
      'disconnected'
    );
  });

  it('surfaces an account in error even when the row still says connected', () => {
    expect(
      marketplaceAccountStatus(
        marketplaceItem({ account: { handle: 'seller@example.test', status: 'error' } })
      )
    ).toBe('error');
  });
});

describe('Marketplace Accounts panel', () => {
  it('shows brand mark, handle, Connected and a Manage link to Marketplaces', () => {
    const html = render(<MarketplaceAccountsList items={[marketplaceItem()]} />);
    const text = visibleText(html);

    expect(html).toContain('aria-label="OLX marketplace logo"');
    expect(text).toContain('OLX');
    expect(text).toContain('seller@example.test');
    expect(text).toContain('Connected');
    expect(text).not.toContain('Disconnected');
    expect(text).not.toContain('Sandbox');
    expect(html).toMatch(/<a[^>]*href="\/marketplaces"[^>]*>Manage</);
  });

  it('labels sandbox accounts and stays silent when the flag is false', () => {
    const sandboxed = render(
      <MarketplaceAccountsList items={[marketplaceItem({ sandbox: true })]} />
    );
    const explicitlyLive = render(
      <MarketplaceAccountsList items={[marketplaceItem({ sandbox: false })]} />
    );

    expect(visibleText(sandboxed)).toContain('Sandbox');
    expect(visibleText(explicitlyLive)).not.toContain('Sandbox');
  });

  it('shows a disconnected row without inventing an account', () => {
    const html = render(
      <MarketplaceAccountsList items={[marketplaceItem({ connected: false, account: null })]} />
    );
    const text = visibleText(html);

    expect(text).toContain('Disconnected');
    expect(text).toContain('No account linked');
    expect(text).not.toContain('seller@example.test');
    expect(html).toMatch(/href="\/marketplaces"/);
  });

  it('keeps the retained handle and shows an error state for unusable credentials', () => {
    const text = visibleText(
      render(
        <MarketplaceAccountsList
          items={[marketplaceItem({ account: { handle: 'seller@example.test', status: 'error' } })]}
        />
      )
    );

    expect(text).toContain('seller@example.test');
    expect(text).toContain('Error');
    expect(text).not.toContain('Connected');
  });

  it('shows an OLX item flagged unavailable as a normal connected account', () => {
    const html = render(
      <MarketplaceAccountsList items={[marketplaceItem({ available: false })]} />
    );
    const text = visibleText(html);

    expect(text).not.toContain('Roadmap');
    expect(text).not.toContain('Not available');
    expect(text).toContain('seller@example.test');
    expect(text).toContain('Connected');
    expect(html).toMatch(/<a[^>]*href="\/marketplaces"[^>]*>Manage</);
  });

  it('ignores a stored marketplace that is not OLX', () => {
    const text = visibleText(
      render(
        <MarketplaceAccountsList
          items={[
            marketplaceItem(),
            marketplaceItem({
              id: 'marketplace-allegro',
              providerKey: 'allegro',
              name: 'Allegro',
            }),
          ]}
        />
      )
    );

    expect(text).toContain('OLX');
    expect(text).not.toContain('Allegro');
  });

  it('explains an empty list instead of rendering nothing', () => {
    expect(visibleText(render(<MarketplaceAccountsList items={[]} />))).toContain(
      'No marketplace accounts'
    );
  });
});

describe('Appearance options', () => {
  it('offers Light, Dark and System themes and both interface densities', () => {
    expect(themeModeOptions.map(({ value, label }) => [value, label])).toEqual([
      ['light', 'Light'],
      ['dark', 'Dark'],
      ['system', 'System'],
    ]);
    expect(densityOptions.map(({ value, label }) => [value, label])).toEqual([
      ['comfortable', 'Comfortable'],
      ['compact', 'Compact'],
    ]);
  });
});
