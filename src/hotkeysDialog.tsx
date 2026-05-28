import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

const hotkeys = [
  { keys: ['/'], action: 'Focus the search field.' },
  { keys: ['Esc'], action: 'Clear the active search query.' },
  { keys: ['f'], action: 'Fit the whole map into view.' },
  { keys: ['d'], action: 'Show or hide the details sidebar.' },
];

type HotkeysDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function HotkeysDialog({ open, onClose }: HotkeysDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="hotkeys-dialog-title"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="hotkeys-dialog-title">Hotkeys</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          {hotkeys.map((hotkey) => (
            <Box
              key={hotkey.keys.join('+')}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(92px, auto) 1fr',
                gap: 1.5,
                alignItems: 'center',
              }}
            >
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {hotkey.keys.map((key) => (
                  <Box
                    key={key}
                    component="kbd"
                    sx={{
                      minWidth: 28,
                      px: 0.75,
                      py: 0.25,
                      border: '1px solid var(--line)',
                      borderRadius: '6px',
                      bgcolor: 'var(--panel-soft)',
                      color: 'var(--ink)',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 800,
                      lineHeight: 1.5,
                      textAlign: 'center',
                    }}
                  >
                    {key}
                  </Box>
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {hotkey.action}
              </Typography>
            </Box>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Global hotkeys are ignored while typing in text inputs.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
