import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { baseApi } from './api/baseApi.js';
import authReducer, { logout } from './slices/authSlice.js';
import workspaceReducer, { clearWorkspace } from './slices/workspaceSlice.js';
import uiReducer from './slices/uiSlice.js';

// A factory so tests can build an isolated store with the production wiring.
export function createAppStore() {
  // Whoever dispatches `logout` (the account menu, an expired session) gets the same cleanup, so
  // the next person on a shared browser never sees the previous user's cached API data or workspace.
  const logoutCleanup = createListenerMiddleware();
  logoutCleanup.startListening({
    actionCreator: logout,
    effect: (_action, { dispatch }) => {
      dispatch(clearWorkspace());
      dispatch(baseApi.util.resetApiState());
    },
  });

  return configureStore({
    reducer: {
      auth: authReducer,
      workspace: workspaceReducer,
      ui: uiReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredActions: ['hydrate'],
          ignoredPaths: [],
        },
      })
        .prepend(logoutCleanup.middleware)
        .concat(baseApi.middleware),
  });
}

export const store = createAppStore();

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
