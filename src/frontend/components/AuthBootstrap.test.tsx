import { configureStore } from '@reduxjs/toolkit';
import authReducer, { logout, setCredentials } from '../state/slices/authSlice';
import uiReducer, { setThemeMode, type ThemeMode } from '../state/slices/uiSlice';
import workspaceReducer from '../state/slices/workspaceSlice';
import { AuthBootstrap } from './AuthBootstrap';

type Effect = () => void | (() => void);

// This suite has no DOM, so React never schedules effects. This stand-in hands the component
// persistent refs and runs each effect when its dependencies change, the way React would.
const mockRuntime = {
  refs: [] as Array<{ current: unknown }>,
  refCursor: 0,
  effectDeps: [] as Array<readonly unknown[] | undefined>,
  effectCursor: 0,
  layoutQueue: [] as Effect[],
  passiveQueue: [] as Effect[],
};

function mockScheduleEffect(queue: Effect[], effect: Effect, deps?: readonly unknown[]) {
  const previous = mockRuntime.effectDeps[mockRuntime.effectCursor];
  mockRuntime.effectDeps[mockRuntime.effectCursor++] = deps;
  const changed = !previous || !deps || deps.some((dep, index) => !Object.is(dep, previous[index]));
  if (changed) queue.push(effect);
}

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (initial: unknown) =>
    (mockRuntime.refs[mockRuntime.refCursor++] ??= { current: initial }),
  useLayoutEffect: (effect: Effect, deps?: readonly unknown[]) =>
    mockScheduleEffect(mockRuntime.layoutQueue, effect, deps),
  useEffect: (effect: Effect, deps?: readonly unknown[]) =>
    mockScheduleEffect(mockRuntime.passiveQueue, effect, deps),
}));

function buildStore() {
  return configureStore({
    reducer: { auth: authReducer, workspace: workspaceReducer, ui: uiReducer },
  });
}

let mockStore: ReturnType<typeof buildStore>;
const mockSavedThemes = new Map<string, ThemeMode>();

jest.mock('../state/hooks.js', () => ({
  useAppDispatch: () => mockStore.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(mockStore.getState()),
}));

// The network is the only thing stubbed: nobody is loading a profile, and the saved
// preferences are whatever the test put in mockSavedThemes for the requesting principal.
jest.mock('../services/hooks/index.js', () => ({
  useMe: () => ({ data: undefined, isError: false }),
  useWorkspace: () => ({ data: undefined }),
}));

jest.mock('../state/api/settingsApi.js', () => ({
  useGetUserPreferencesQuery: (principal: unknown) => {
    const { workspaceId, userId } = (principal ?? {}) as { workspaceId?: string; userId?: string };
    const themeMode = mockSavedThemes.get(`${workspaceId}:${userId}`);
    return { currentData: themeMode ? { themeMode } : undefined };
  },
}));

/** Renders and runs effects until React would have nothing left to do. */
function renderBootstrap() {
  for (let pass = 0; pass < 10; pass++) {
    mockRuntime.refCursor = 0;
    mockRuntime.effectCursor = 0;
    mockRuntime.layoutQueue = [];
    mockRuntime.passiveQueue = [];
    AuthBootstrap({ children: null });
    const queued = [...mockRuntime.layoutQueue, ...mockRuntime.passiveQueue];
    if (queued.length === 0) return;
    queued.forEach((effect) => effect());
  }
  throw new Error('AuthBootstrap kept scheduling effects');
}

function signIn(userId: string, workspaceId = 'ws-1') {
  mockStore.dispatch(
    setCredentials({
      token: 'test-token',
      user: {
        id: userId,
        email: `${userId}@example.test`,
        workspaceId,
        createdAt: '2026-07-14T00:00:00.000Z',
      },
    })
  );
}

const themeMode = () => mockStore.getState().ui.themeMode;

describe('AuthBootstrap theme', () => {
  beforeEach(() => {
    mockStore = buildStore();
    mockSavedThemes.clear();
    mockRuntime.refs = [];
    mockRuntime.effectDeps = [];
  });

  it('keeps the theme chosen on this device while a principal signs in', () => {
    mockStore.dispatch(setThemeMode('dark'));
    renderBootstrap();

    signIn('user-a');
    renderBootstrap();

    expect(themeMode()).toBe('dark');
  });

  it('applies the saved theme once per principal and leaves later changes alone', () => {
    signIn('user-a');
    mockSavedThemes.set('ws-1:user-a', 'dark');
    renderBootstrap();
    expect(themeMode()).toBe('dark');

    mockStore.dispatch(setThemeMode('light'));
    mockSavedThemes.set('ws-1:user-a', 'system');
    renderBootstrap();

    expect(themeMode()).toBe('light');
  });

  it('applies the saved theme of each principal that signs in, including a returning one', () => {
    signIn('user-a');
    mockSavedThemes.set('ws-1:user-a', 'dark');
    mockSavedThemes.set('ws-1:user-b', 'light');
    renderBootstrap();
    expect(themeMode()).toBe('dark');

    mockStore.dispatch(setThemeMode('system'));
    mockStore.dispatch(logout());
    renderBootstrap();
    signIn('user-b');
    renderBootstrap();
    expect(themeMode()).toBe('light');

    mockStore.dispatch(logout());
    renderBootstrap();
    signIn('user-a');
    renderBootstrap();
    expect(themeMode()).toBe('dark');
  });
});
