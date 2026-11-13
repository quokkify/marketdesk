// Search-as-you-type OLX category picker. Behaviour lives in olxCategorySearch.ts;
// the endpoint is supplied through the `search` prop.
import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  FormHelperText,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { OlxCategorySearchResult } from '../../state/api/listingsApi.js';
import type { WizardOlxCategory } from './productFormModel.js';
import {
  createOlxCategorySearch,
  type OlxCategorySearchState,
} from './olxCategorySearch.js';

export interface OlxCategoryPickerProps {
  value: WizardOlxCategory | null;
  onChange: (value: WizardOlxCategory | null) => void;
  search: (query: string) => Promise<OlxCategorySearchResult[]>;
  seed?: string;
  error?: string;
  disabled?: boolean;
}

export interface OlxCategoryPickerViewProps {
  value: WizardOlxCategory | null;
  state: OlxCategorySearchState;
  error?: string;
  disabled?: boolean;
  onQueryChange: (query: string) => void;
  onPick: (result: OlxCategorySearchResult) => void;
  onChangeRequested: () => void;
}

const PATH_SEPARATOR = ' > ';

export const OlxCategoryPickerView: React.FC<OlxCategoryPickerViewProps> = ({
  value,
  state,
  error,
  disabled,
  onQueryChange,
  onPick,
  onChangeRequested,
}) => (
  <Stack spacing={1}>
    {value ? (
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="body1">{value.path.join(PATH_SEPARATOR)}</Typography>
        <Button size="small" onClick={onChangeRequested} disabled={disabled}>
          Change
        </Button>
      </Stack>
    ) : (
      <>
        <TextField
          label="OLX category"
          fullWidth
          value={state.query}
          disabled={disabled}
          onChange={(e) => onQueryChange(e.target.value)}
          error={Boolean(error)}
        />
        {state.status === 'searching' && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Searching OLX categories…</Typography>
          </Stack>
        )}
        {state.status === 'empty' && (
          <Typography variant="body2" color="text.secondary">
            No matching OLX categories. Try a shorter or different word.
          </Typography>
        )}
        {state.status === 'unavailable' && (
          <Typography variant="body2" color="error">
            OLX category search is unavailable right now. You can save the product as a draft.
          </Typography>
        )}
        {state.status === 'results' && (
          <Box>
            <List dense disablePadding>
              {state.results.map((result) => (
                <ListItemButton
                  key={result.providerCategoryId}
                  onClick={() => onPick(result)}
                  disabled={disabled}
                >
                  <ListItemText primary={result.path.join(PATH_SEPARATOR)} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}
      </>
    )}
    {error && <FormHelperText error>{error}</FormHelperText>}
  </Stack>
);

export const OlxCategoryPicker: React.FC<OlxCategoryPickerProps> = ({
  value,
  onChange,
  search,
  seed,
  error,
  disabled,
}) => {
  const [state, setState] = useState<OlxCategorySearchState>({
    query: seed ?? '',
    status: 'idle',
    results: [],
  });
  const [changing, setChanging] = useState(false);
  const searchRef = useRef(search);
  searchRef.current = search;
  const controllerRef = useRef<ReturnType<typeof createOlxCategorySearch> | null>(null);

  useEffect(() => {
    const controller = createOlxCategorySearch({
      search: (query) => searchRef.current(query),
      onState: setState,
    });
    controllerRef.current = controller;
    if (seed) controller.searchSeed(seed);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // The seed is searched once on mount only.
  }, []);

  return (
    <OlxCategoryPickerView
      value={changing ? null : value}
      state={state}
      error={error}
      disabled={disabled}
      onQueryChange={(query) => controllerRef.current?.setQuery(query)}
      onPick={(result) => {
        setChanging(false);
        onChange({ providerCategoryId: result.providerCategoryId, name: result.name, path: result.path });
      }}
      onChangeRequested={() => setChanging(true)}
    />
  );
};
