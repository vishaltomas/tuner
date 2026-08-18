import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CssBaseline from '@mui/material/CssBaseline'
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles'
import './index.css'
import App from './App.tsx'
import { theme } from './theme.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* `enableCssLayer` puts MUI's styles in `@layer mui` so Tailwind
        utilities can override them — see the layer order in index.css. */}
    <StyledEngineProvider enableCssLayer>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline />
        <App />
      </ThemeProvider>
    </StyledEngineProvider>
  </StrictMode>,
)
