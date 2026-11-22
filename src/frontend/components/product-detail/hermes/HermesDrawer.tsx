// Right-side drawer behind the Hermes card: one tab per detail. Esc and Close dismiss it, and the modal
// returns focus to the element that opened it.
import React, { useId } from 'react';
import { Box, Button, Drawer, Stack, Tab, Tabs, Typography } from '@mui/material';
import type { HermesDrawerTab } from './hermesCardModel.js';

export interface HermesDrawerProps {
  open: boolean;
  tab: HermesDrawerTab;
  onTabChange: (tab: HermesDrawerTab) => void;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const TABS: ReadonlyArray<{ tab: HermesDrawerTab; label: string }> = [
  { tab: 'prices', label: 'Market prices' },
  { tab: 'checks', label: 'Checks' },
  { tab: 'suggestions', label: 'Suggestions' },
  { tab: 'history', label: 'Log and history' },
];

export const HermesDrawer: React.FC<HermesDrawerProps> = ({ open, tab, onTabChange, onClose, title, children }) => {
  const id = useId();
  const titleId = `${id}-title`;
  const tabId = (value: HermesDrawerTab) => `${id}-tab-${value}`;
  const panelId = `${id}-panel`;
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      data-testid="hermes-drawer"
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: {
            width: 'min(560px, 100%)',
            display: 'flex',
            flexDirection: 'column',
            pt: 'env(safe-area-inset-top, 0px)',
            pb: 'env(safe-area-inset-bottom, 0px)',
          },
        },
      }}
    >
      <Stack spacing={1.5} sx={{ px: 2.5, pt: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography id={titleId} variant="h6" component="h2" sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          <Button variant="outlined" onClick={onClose} data-testid="hermes-drawer-close" sx={{ flexShrink: 0 }}>
            Close
          </Button>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, value: HermesDrawerTab) => onTabChange(value)}
          variant="scrollable"
          scrollButtons={false}
          aria-label="Hermes details"
        >
          {TABS.map((item) => (
            <Tab
              key={item.tab}
              value={item.tab}
              label={item.label}
              id={tabId(item.tab)}
              aria-controls={panelId}
              data-testid={`hermes-tab-${item.tab}`}
            />
          ))}
        </Tabs>
      </Stack>
      <Box
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(tab)}
        sx={{ px: 2.5, pt: 2, pb: 3, overflowY: 'auto', flexGrow: 1, minWidth: 0 }}
      >
        {children}
      </Box>
    </Drawer>
  );
};
