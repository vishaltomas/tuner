import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import type { FlowFile } from '../../lib/types'
import { formatBytes, formatDate } from '../../lib/utils'

interface FlowTreeProps {
  files: FlowFile[]
  /** The flow currently open on the canvas. */
  open: string
  /** Flows named by Agent widgets in the open flow, marked as called. */
  called: string[]
  /** Set when the open flow has edits that are not on disk yet. */
  dirty: boolean
  onOpen: (name: string) => void
  onCreate: () => void
  onDelete: (name: string) => void
}

/**
 * The flow directory.
 *
 * `main.flow` is where a run starts, so it is pinned to the top and marked;
 * every other flow is reached from it through an Agent widget, and the ones
 * the open flow calls are marked too — which is the only place the shape of
 * the whole thing is visible at once.
 */
export function FlowTree({
  files,
  open,
  called,
  dirty,
  onOpen,
  onCreate,
  onDelete,
}: FlowTreeProps) {
  return (
    <Box className="flex flex-col py-1">
      {files.map((file) => {
        const isOpen = file.name === open
        const isCalled = called.includes(file.name)

        return (
          <Box
            key={file.name}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(file.name)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(file.name)
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1,
              py: 0.75,
              borderRadius: 1.5,
              cursor: 'pointer',
              bgcolor: isOpen ? 'action.selected' : undefined,
              '&:hover': { bgcolor: isOpen ? 'action.selected' : 'action.hover' },
              '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
            }}
          >
            {file.isMain ? (
              <Tooltip title="Where a run starts">
                <PlayArrowOutlinedIcon fontSize="small" color="success" />
              </Tooltip>
            ) : (
              <InsertDriveFileOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            )}

            <Box className="min-w-0 flex-1">
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: isOpen ? 600 : 400, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              >
                {file.name}
                {isOpen && dirty ? ' •' : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatBytes(file.size)} · {formatDate(file.updatedAt)}
              </Typography>
            </Box>

            {isCalled && (
              <Tooltip title="Called by an Agent widget in the open flow">
                <Chip label="called" color="secondary" variant="outlined" />
              </Tooltip>
            )}

            {!file.isMain && (
              <Tooltip title={`Delete ${file.name}`}>
                <IconButton
                  size="small"
                  aria-label={`Delete ${file.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDelete(file.name)
                  }}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      })}

      <Box
        role="button"
        tabIndex={0}
        onClick={onCreate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onCreate()
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.75,
          mt: 0.5,
          borderRadius: 1.5,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
          '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
        }}
      >
        <AddIcon fontSize="small" />
        <Typography variant="body2">New flow…</Typography>
      </Box>
    </Box>
  )
}
