import type { User } from '@shared/types';
import reducer, { logout, setCredentials, setToken } from './authSlice';

const user: User = {
  id: 'user-a',
  email: 'a@example.test',
  workspaceId: 'ws-1',
  createdAt: '2026-10-24T00:00:00.000Z',
};

// The frontend tests run without a DOM, so localStorage is a small in-memory stand-in.
const storage = new Map<string, string>();

describe('authSlice setToken', () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('replaces the token, keeps the user and persists the new token', () => {
    const before = reducer(undefined, setCredentials({ token: 't1', user }));

    const after = reducer(before, setToken('t2'));

    expect(after).toEqual({ token: 't2', user, isAuthenticated: true });
    expect(localStorage.getItem('marketdesk.token')).toBe('t2');
  });

  it('is undone by logout', () => {
    const state = reducer(
      reducer(undefined, setCredentials({ token: 't1', user })),
      setToken('t2')
    );

    expect(reducer(state, logout()).token).toBeNull();
    expect(localStorage.getItem('marketdesk.token')).toBeNull();
  });

  // Regression guard: a late password-change answer used to write a token after sign-out.
  it('is a no-op when nobody is signed in', () => {
    const signedOut = reducer(reducer(undefined, setCredentials({ token: 't1', user })), logout());

    const after = reducer(signedOut, setToken('late'));

    expect(after.token).toBeNull();
    expect(localStorage.getItem('marketdesk.token')).toBeNull();
  });

  it('logout leaves the stored token of another tab alone', () => {
    const state = reducer(undefined, setCredentials({ token: 't1', user }));
    localStorage.setItem('marketdesk.token', 'other-tab-token');

    reducer(state, logout());

    expect(localStorage.getItem('marketdesk.token')).toBe('other-tab-token');
  });
});
