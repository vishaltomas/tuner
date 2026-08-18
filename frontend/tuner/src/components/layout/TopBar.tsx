import { AppBar, Box, Chip, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import MenuIcon from '@mui/icons-material/Menu'
import { useBackendStatus } from '../../hooks/useBackendStatus'

const STATUS = {
  checking: {
    label: 'Connecting…',
    color: 'default' as const,
    tooltip: 'Contacting the embedding backend.',
    dot: 'text.disabled',
  },
  online: {
    label: 'Backend online',
    color: 'success' as const,
    tooltip: 'Connected to the embedding backend.',
    dot: 'success.main',
  },
  offline: {
    label: 'Local preview',
    color: 'warning' as const,
    tooltip: 'The embedding backend is not reachable — changes stay in this browser.',
    dot: 'warning.main',
  },
}

export function TopBar({ onToggleNav }: { onToggleNav: () => void }) {
  const status = STATUS[useBackendStatus()]

  return (
    <AppBar
      position="static"
      color="default"
      elevation={0}
      sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
    >
      <Toolbar variant="dense" className="gap-3" sx={{ minHeight: 56 }}>
        <IconButton
          edge="start"
          size="small"
          aria-label="Toggle navigation"
          onClick={onToggleNav}
          sx={{ display: { md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        <Box
          sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}
          className="flex size-8 items-center justify-center rounded-lg"
        >
          <GraphicEqIcon fontSize="small" />
        </Box>

        <Box className="flex-1 leading-tight">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            Tuner
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Embeddings workbench
          </Typography>
        </Box>

        <Tooltip title={status.tooltip}>
          <Chip
            variant="outlined"
            color={status.color}
            label={
              <Box className="flex items-center gap-1.5">
                <Box
                  component="span"
                  sx={{ bgcolor: status.dot }}
                  className="size-1.5 rounded-full"
                />
                {status.label}
              </Box>
            }
          />
        </Tooltip>
      </Toolbar>
    </AppBar>
  )
}
