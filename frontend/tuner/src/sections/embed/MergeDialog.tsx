import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import type { Source } from '../../lib/types'
import { formatCount, totalChunks } from '../../lib/utils'

interface MergeDialogProps {
  open: boolean
  selected: Source[]
  busy: boolean
  onClose: () => void
  onMerge: (name: string, keepOriginals: boolean) => Promise<void>
}

export function MergeDialog({ open, selected, busy, onClose, onMerge }: MergeDialogProps) {
  const [name, setName] = useState('')
  const [keepOriginals, setKeepOriginals] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(selected.map((source) => source.name).join(' + ').slice(0, 60))
      setError('')
    }
  }, [open, selected])

  const models = new Set(selected.map((source) => source.model))
  // Vectors from different models share no geometry, so a merged source made
  // of both would return nonsense for any query.
  const mixedModels = models.size > 1
  const documents = selected.reduce((sum, source) => sum + source.documents.length, 0)
  const vectors = selected.reduce((sum, source) => sum + totalChunks(source.documents), 0)

  async function handleMerge() {
    if (!name.trim()) {
      setError('Give the merged source a name.')
      return
    }
    await onMerge(name.trim(), keepOriginals)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 0.5 }}>
        Merge sources
        <Typography variant="body2" color="text.secondary">
          Combine the selected sources into a single searchable source.
        </Typography>
      </DialogTitle>

      <DialogContent className="flex flex-col gap-4" sx={{ pt: '16px !important' }}>
        <Box className="flex flex-col gap-1.5">
          {selected.map((source) => (
            <Paper
              key={source.id}
              variant="outlined"
              className="flex items-center gap-2 px-3 py-2"
              sx={{ borderRadius: 2 }}
            >
              <Typography variant="body2" noWrap className="flex-1">
                {source.name}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: 'var(--font-mono)' }}
              >
                {source.model}
              </Typography>
            </Paper>
          ))}
        </Box>

        {mixedModels && (
          <Alert severity="error">
            These sources were embedded with different models, so their vectors cannot be searched
            together. Select sources that share one model, or re-embed them under the same model
            first.
          </Alert>
        )}

        <TextField
          required
          label="Merged source name"
          value={name}
          disabled={busy}
          error={Boolean(error)}
          helperText={
            error || `${documents} documents · ${formatCount(vectors)} vectors will move into it.`
          }
          onChange={(event) => setName(event.target.value)}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={keepOriginals}
              disabled={busy}
              onChange={(event) => setKeepOriginals(event.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body2">Keep the original sources</Typography>
              <Typography variant="caption" color="text.secondary">
                Leave unchecked to replace them with the merged source.
              </Typography>
            </Box>
          }
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<CallMergeIcon />}
          loading={busy}
          loadingPosition="start"
          disabled={mixedModels || selected.length < 2}
          onClick={handleMerge}
        >
          Merge {selected.length} sources
        </Button>
      </DialogActions>
    </Dialog>
  )
}
