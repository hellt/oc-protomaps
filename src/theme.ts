import { alpha, createTheme } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark';

const lightColors = {
  pageBg: '#e6e9ef',
  panel: '#eff1f5',
  panelSoft: '#dce0e8',
  ink: '#4c4f69',
  muted: '#6c6f85',
  line: '#bcc0cc',
  blue: '#1e66f5',
  teal: '#179299',
  amber: '#df8e1d',
  red: '#d20f39',
};

const darkColors = {
  pageBg: '#181825',
  panel: '#1e1e2e',
  panelSoft: '#313244',
  ink: '#cdd6f4',
  muted: '#a6adc8',
  line: '#45475a',
  blue: '#89b4fa',
  teal: '#94e2d5',
  amber: '#f9e2af',
  red: '#f38ba8',
};

export function createAppTheme(mode: ThemeMode) {
  const colors = mode === 'dark' ? darkColors : lightColors;

  return createTheme({
    palette: {
      mode,
      primary: {
        main: colors.blue,
      },
      secondary: {
        main: colors.teal,
      },
      warning: {
        main: colors.amber,
      },
      error: {
        main: colors.red,
      },
      background: {
        default: colors.pageBg,
        paper: colors.panel,
      },
      divider: colors.line,
      text: {
        primary: colors.ink,
        secondary: colors.muted,
      },
    },
    shape: {
      borderRadius: 7,
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      button: {
        fontWeight: 800,
        letterSpacing: 0,
        textTransform: 'none',
      },
    },
    components: {
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            minHeight: 34,
            borderRadius: 7,
            fontWeight: 800,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 7,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            border: `1px solid ${colors.line}`,
            borderRadius: 8,
            backgroundImage: 'none',
            boxShadow:
              mode === 'dark'
                ? '0 18px 42px rgba(17, 17, 27, 0.55)'
                : '0 18px 42px rgba(76, 79, 105, 0.18)',
          },
          list: {
            padding: 4,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 32,
            borderRadius: 6,
            gap: 8,
            fontSize: 13,
            fontWeight: 800,
            '&.Mui-selected': {
              backgroundColor: alpha(colors.blue, mode === 'dark' ? 0.18 : 0.1),
              color: colors.blue,
            },
            '&.Mui-selected:hover': {
              backgroundColor: alpha(colors.blue, mode === 'dark' ? 0.24 : 0.14),
            },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 38,
          },
          indicator: {
            display: 'none',
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 30,
            minWidth: 66,
            padding: '0 10px',
            borderRadius: 6,
            color: colors.muted,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: 0,
            textTransform: 'none',
            '&.Mui-selected': {
              backgroundColor: colors.panel,
              color: colors.blue,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            backgroundColor: colors.panel,
          },
          input: {
            fontSize: 13,
            fontWeight: 700,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: 20,
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 800,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            border: `1px solid ${mode === 'dark' ? colors.panelSoft : colors.muted}`,
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 700,
          },
        },
      },
    },
  });
}
