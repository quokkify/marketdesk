import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildTheme } from './themeOptions';

// public/theme-boot.js runs before React (a plain script, because the backend
// CSP blocks inline scripts) so the first paint already uses the right theme.
const script = readFileSync(path.join(process.cwd(), 'public/theme-boot.js'), 'utf8');

interface BootOptions {
  stored?: string | null;
  prefersDark?: boolean;
  storageThrows?: boolean;
  withoutMatchMedia?: boolean;
}

function boot({
  stored = null,
  prefersDark = false,
  storageThrows = false,
  withoutMatchMedia = false,
}: BootOptions) {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const readKeys: string[] = [];
  const window = {
    localStorage: {
      getItem(key: string) {
        readKeys.push(key);
        if (storageThrows) throw new Error('storage blocked');
        return stored;
      },
    },
    matchMedia: withoutMatchMedia
      ? undefined
      : (query: string) => ({ matches: prefersDark && query === '(prefers-color-scheme: dark)' }),
  };
  vm.runInNewContext(script, { window, document: { documentElement: root } });
  return { root, readKeys };
}

const lightBg = buildTheme('light').palette.background.default;
const darkBg = buildTheme('dark').palette.background.default;

describe('theme boot script', () => {
  it('applies a stored dark preference before React mounts', () => {
    const { root, readKeys } = boot({ stored: 'dark' });
    expect(readKeys).toEqual(['marketdesk.themeMode']);
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.backgroundColor).toBe(darkBg);
  });

  it('lets a stored light preference win over a dark OS setting', () => {
    const { root } = boot({ stored: 'light', prefersDark: true });
    expect(root.dataset.theme).toBe('light');
    expect(root.style.backgroundColor).toBe(lightBg);
  });

  it('follows the OS setting for system mode', () => {
    expect(boot({ stored: 'system', prefersDark: true }).root.dataset.theme).toBe('dark');
    expect(boot({ stored: 'system', prefersDark: false }).root.dataset.theme).toBe('light');
  });

  it('treats a missing or unknown value as system mode', () => {
    expect(boot({ stored: null, prefersDark: true }).root.dataset.theme).toBe('dark');
    expect(boot({ stored: 'sepia', prefersDark: false }).root.dataset.theme).toBe('light');
  });

  it('falls back to system mode when storage is blocked', () => {
    const { root } = boot({ storageThrows: true, prefersDark: true });
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.backgroundColor).toBe(darkBg);
  });

  it('defaults to light when the browser cannot report a colour scheme', () => {
    const { root } = boot({ stored: 'system', withoutMatchMedia: true });
    expect(root.dataset.theme).toBe('light');
    expect(root.style.backgroundColor).toBe(lightBg);
  });
});
