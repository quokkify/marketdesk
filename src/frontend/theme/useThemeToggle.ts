// Top-bar theme toggle: flips the theme in effect at once, then saves the choice to the
// signed-in user's preferences. A failed save restores the previous mode and says so.
import { useTheme } from '@mui/material/styles';
import { useAppDispatch, useAppSelector } from '../state/hooks.js';
import { useUpdateUserPreferencesMutation } from '../state/api/settingsApi.js';
import { enqueueToast, setThemeMode } from '../state/slices/uiSlice.js';

export function useThemeToggle() {
  const dispatch = useAppDispatch();
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  const workspaceId = useAppSelector((state) => state.workspace.id);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const resolvedMode = useTheme().palette.mode;
  const [updatePreferences] = useUpdateUserPreferencesMutation();

  const toggle = async () => {
    const next = resolvedMode === 'dark' ? 'light' : 'dark';
    dispatch(setThemeMode(next));
    // Without a signed-in principal there is no account to save to; the choice stays on this device.
    if (!workspaceId || !userId) return;
    try {
      await updatePreferences({
        principal: { workspaceId, userId },
        patch: { themeMode: next },
      }).unwrap();
    } catch {
      dispatch(setThemeMode(themeMode));
      dispatch(
        enqueueToast({
          message: 'Theme could not be saved. Your previous theme was restored.',
          severity: 'error',
        })
      );
    }
  };

  return { resolvedMode, toggle };
}
