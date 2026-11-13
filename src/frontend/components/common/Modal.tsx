// Generic dialog wrapper with title bar, close button, and an actions slot.
import React from 'react';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import type { Breakpoint, Theme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: Breakpoint | false;
  fullWidth?: boolean;
  dividers?: boolean;
  closeDisabled?: boolean;
  // Fills the screen below the `sm` breakpoint.
  fullScreenOnMobile?: boolean;
}

// The paper styles MUI applies for `fullScreen`, limited to narrow screens. A breakpoint
// style rather than a media-query hook keeps the first render right on a phone.
const fullScreenBelowSm = (theme: Theme) => ({
  [theme.breakpoints.down('sm')]: {
    margin: 0,
    width: '100%',
    maxWidth: '100%',
    height: '100%',
    maxHeight: 'none',
    borderRadius: 0,
  },
});

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  dividers = true,
  closeDisabled = false,
  fullScreenOnMobile = false,
}) => (
  <Dialog
    open={open}
    onClose={closeDisabled ? undefined : onClose}
    maxWidth={maxWidth}
    fullWidth={fullWidth}
    slotProps={fullScreenOnMobile ? { paper: { sx: fullScreenBelowSm } } : undefined}
  >
    {(title || subtitle) && (
      <DialogTitle component="div" sx={{ pr: 6 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            {title && (
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </div>
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={onClose}
          disabled={closeDisabled}
          sx={{ position: 'absolute', right: 12, top: 12, color: 'text.secondary' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
    )}
    <DialogContent dividers={dividers}>{children}</DialogContent>
    {actions && <DialogActions sx={{ px: 3, py: 2 }}>{actions}</DialogActions>}
  </Dialog>
);

export default Modal;
