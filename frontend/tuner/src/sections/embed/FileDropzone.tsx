import { useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import { formatBytes, kindOf } from '../../lib/utils'

const ACCEPT = '.pdf,.txt,application/pdf,text/plain'

interface FileDropzoneProps {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
}

/** Drag-and-drop / click-to-browse picker restricted to PDF and TXT files. */
export function FileDropzone({ files, onChange, disabled }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const accepted: File[] = []
    const refused: string[] = []

    for (const file of Array.from(incoming)) {
      if (!kindOf(file)) {
        refused.push(file.name)
        continue
      }
      // Same name and size twice is a re-drop, not a second document.
      const duplicate = [...files, ...accepted].some(
        (existing) => existing.name === file.name && existing.size === file.size,
      )
      if (!duplicate) accepted.push(file)
    }

    setRejected(refused)
    if (accepted.length) onChange([...files, ...accepted])
  }

  return (
    <Box className="flex flex-col gap-3">
      <Paper
        variant="outlined"
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!disabled) addFiles(event.dataTransfer.files)
        }}
        sx={{
          borderStyle: 'dashed',
          borderColor: dragging ? 'primary.main' : 'divider',
          bgcolor: dragging ? 'action.hover' : 'transparent',
          transition: 'border-color 150ms, background-color 150ms',
          opacity: disabled ? 0.6 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
        }}
        className="flex flex-col items-center px-6 py-7 text-center"
      >
        <Box
          sx={{ bgcolor: 'action.hover', color: 'text.secondary' }}
          className="mb-3 flex size-10 items-center justify-center rounded-full"
        >
          <CloudUploadOutlinedIcon fontSize="small" />
        </Box>
        <Typography variant="subtitle2">Drag documents here</Typography>
        <Typography variant="caption" color="text.secondary">
          PDF and TXT files, up to 50 at a time
        </Typography>
        <Button
          variant="outlined"
          size="small"
          className="mt-3"
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </Paper>

      {rejected.length > 0 && (
        <Alert severity="warning" onClose={() => setRejected([])}>
          Skipped {rejected.join(', ')} — only PDF and TXT files can be embedded.
        </Alert>
      )}

      {files.length > 0 && (
        <List dense disablePadding className="flex flex-col gap-1.5">
          {files.map((file, index) => (
            <ListItem
              key={`${file.name}-${file.size}`}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  disabled={disabled}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onChange(files.filter((_, position) => position !== index))}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <DescriptionOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={file.name}
                secondary={formatBytes(file.size)}
                slotProps={{
                  primary: { noWrap: true, sx: { fontSize: 14 } },
                  secondary: { sx: { fontSize: 12 } },
                }}
              />
              <Chip label={kindOf(file)?.toUpperCase()} variant="outlined" />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  )
}
