import type {
  ApiResponse,
  HermesSettings,
  IntegrationsSettings,
  UserPreferences,
  UserPreferencesPatch,
  WorkspaceSettings,
  WorkspaceSettingsPatch,
} from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

export interface SettingsPrincipal {
  workspaceId: string;
  userId: string;
}

export function settingsPrincipalKey(principal: SettingsPrincipal): string {
  return `${principal.workspaceId}:${principal.userId}`;
}

export const settingsRequest = {
  workspace: () => '/settings/workspace',
  preferences: () => '/settings/preferences',
  hermes: () => '/settings/hermes',
  integrations: () => '/settings/integrations',
};

interface PrincipalMutation<T> {
  principal: SettingsPrincipal;
  patch: T;
}

const tagId = (kind: string, principal: SettingsPrincipal) =>
  `${kind}:${settingsPrincipalKey(principal)}`;

export const settingsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getWorkspaceSettings: builder.query<WorkspaceSettings, SettingsPrincipal>({
      query: settingsRequest.workspace,
      transformResponse: (response: ApiResponse<WorkspaceSettings>) => unwrap(response),
      providesTags: (_result, _error, principal) => [
        { type: 'Settings', id: tagId('WORKSPACE', principal) },
      ],
    }),
    updateWorkspaceSettings: builder.mutation<
      WorkspaceSettings,
      PrincipalMutation<WorkspaceSettingsPatch>
    >({
      query: ({ patch }) => ({ url: settingsRequest.workspace(), method: 'PATCH', body: patch }),
      transformResponse: (response: ApiResponse<WorkspaceSettings>) => unwrap(response),
      async onQueryStarted({ principal }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(settingsApi.util.upsertQueryData('getWorkspaceSettings', principal, data));
        } catch {
          // Keep the last confirmed cache value.
        }
      },
      invalidatesTags: (_result, _error, { principal }) => [
        { type: 'Settings', id: tagId('WORKSPACE', principal) },
      ],
    }),
    getUserPreferences: builder.query<UserPreferences, SettingsPrincipal>({
      query: settingsRequest.preferences,
      transformResponse: (response: ApiResponse<UserPreferences>) => unwrap(response),
      providesTags: (_result, _error, principal) => [
        { type: 'Settings', id: tagId('PREFERENCES', principal) },
      ],
    }),
    updateUserPreferences: builder.mutation<
      UserPreferences,
      PrincipalMutation<UserPreferencesPatch>
    >({
      query: ({ patch }) => ({ url: settingsRequest.preferences(), method: 'PATCH', body: patch }),
      transformResponse: (response: ApiResponse<UserPreferences>) => unwrap(response),
      async onQueryStarted({ principal }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(settingsApi.util.upsertQueryData('getUserPreferences', principal, data));
        } catch {
          // Keep the last confirmed cache value.
        }
      },
      invalidatesTags: (_result, _error, { principal }) => [
        { type: 'Settings', id: tagId('PREFERENCES', principal) },
      ],
    }),
    getHermesSettings: builder.query<HermesSettings, SettingsPrincipal>({
      query: settingsRequest.hermes,
      transformResponse: (response: ApiResponse<HermesSettings>) => unwrap(response),
      providesTags: (_result, _error, principal) => [
        { type: 'Settings', id: tagId('HERMES', principal) },
      ],
    }),
    getIntegrationSettings: builder.query<IntegrationsSettings, SettingsPrincipal>({
      query: settingsRequest.integrations,
      transformResponse: (response: ApiResponse<IntegrationsSettings>) => unwrap(response),
      providesTags: (_result, _error, principal) => [
        { type: 'Settings', id: tagId('INTEGRATIONS', principal) },
      ],
    }),
  }),
});

export const {
  useGetWorkspaceSettingsQuery,
  useUpdateWorkspaceSettingsMutation,
  useGetUserPreferencesQuery,
  useUpdateUserPreferencesMutation,
  useGetHermesSettingsQuery,
  useGetIntegrationSettingsQuery,
} = settingsApi;
