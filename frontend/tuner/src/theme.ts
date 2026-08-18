import { createTheme } from '@mui/material/styles'

/**
 * MUI theme for the app.
 *
 * The palette mirrors the tokens in `src/index.css` so MUI components and
 * Tailwind utilities render the same colours; `colorSchemeSelector: 'media'`
 * makes MUI follow `prefers-color-scheme`, the same switch the CSS tokens use.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#8b1fe8' },
        background: { default: '#f7f7f9', paper: '#ffffff' },
        text: { primary: '#08060d', secondary: '#6b6375' },
        divider: '#e5e4e7',
        success: { main: '#157a4a' },
        warning: { main: '#9a6206' },
        error: { main: '#c02626' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#c084fc', contrastText: '#16171d' },
        background: { default: '#101116', paper: '#16171d' },
        text: { primary: '#f3f4f6', secondary: '#9ca3af' },
        divider: '#2e303a',
        success: { main: '#4ade80' },
        warning: { main: '#fbbf24' },
        error: { main: '#f87171' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
    h1: { fontSize: '1.35rem', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: '1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiCardHeader: {
      defaultProps: {
        slotProps: {
          title: { variant: 'h2' },
          subheader: { variant: 'body2' },
        },
      },
      styleOverrides: {
        root: ({ theme }) => ({
          borderBottom: `1px solid ${theme.palette.divider}`,
          padding: theme.spacing(2, 2.5),
        }),
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: theme.spacing(2.5),
          '&:last-child': { paddingBottom: theme.spacing(2.5) },
        }),
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', fullWidth: true },
    },
    MuiChip: {
      defaultProps: { size: 'small' },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
    },
  },
})
