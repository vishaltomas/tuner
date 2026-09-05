import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import type { Deployment } from '../../lib/types'
import { formatCount } from '../../lib/utils'

interface DeployDialogProps {
  open: boolean
  workflow: string
  busy: boolean
  result: Deployment | null
  error: string | null
  onDeploy: (build: boolean) => void
  onClose: () => void
}

/**
 * Packaging a workflow into something runnable elsewhere.
 *
 * The dialog stays open through the export because it is slow — a model is
 * copied and, if Docker is reachable, an image is built — and because what it
 * produces is a command the user has to run, which is worth showing rather
 * than announcing in a toast that disappears.
 */
export function DeployDialog({
  open,
  workflow,
  busy,
  result,
  error,
  onDeploy,
  onClose,
}: DeployDialogProps) {
  const [build, setBuild] = useState(true)

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Deploy “{workflow}”</DialogTitle>

      <DialogContent dividers>
        {!result && !error && (
          <>
            <Typography variant="body2" color="text.secondary">
              Packages this workflow as a Docker image: its flows, the passages they
              retrieve from, and the embedding model that made them. The image needs no
              database — only a Hugging Face token.
            </Typography>
            <FormControlLabel
              className="mt-2"
              control={
                <Switch
                  size="small"
                  checked={build}
                  disabled={busy}
                  onChange={(event) => setBuild(event.target.checked)}
                />
              }
              label={
                <Typography variant="body2">
                  Build the image too, if Docker is running here
                </Typography>
              }
            />
            <Typography variant="caption" color="text.secondary" component="p">
              The build context is written either way. Without this it is left for you to
              build wherever the image should be made.
            </Typography>
          </>
        )}

        {busy && (
          <Box className="mt-3 flex items-center gap-2">
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              {build
                ? 'Packaging and building — installing torch in the image takes a while.'
                : 'Packaging…'}
            </Typography>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {result && (
          <Box className="flex flex-col gap-2">
            <Box className="flex flex-wrap items-center gap-1">
              <Chip
                label={result.built ? 'Image built' : 'Context ready'}
                color={result.built ? 'success' : 'primary'}
                variant="outlined"
              />
              <Chip label={`${result.flows} flows`} variant="outlined" />
              <Chip label={`${formatCount(result.passages)} passages`} variant="outlined" />
              <Chip label={`${result.sizeMb} MB`} variant="outlined" />
            </Box>

            {!result.built && <Alert severity="info">{result.buildNote}</Alert>}
            {!result.modelIncluded && result.model && (
              <Alert severity="info">
                {result.model} is not downloaded here, so the image fetches it while
                building. Download it in Model Catalog first to bake it in instead.
              </Alert>
            )}

            <Divider />
            <Command
              label={result.built ? 'Run it' : 'Build and run it'}
              text={
                (result.built ? '' : `cd ${result.directory}\ndocker build -t ${result.image} .\n`) +
                `docker run --rm -p 8080:8080 \\\n` +
                `  -e HUGGING_FACE_API_TOKEN=hf_... \\\n  ${result.image}`
              }
            />
            <Command
              label="Ask it something"
              text={`curl -s localhost:8080/ask -H 'Content-Type: application/json' \\\n  -d '{"message": "your question"}'`}
            />
            <Typography variant="caption" color="text.secondary">
              The vectors are a snapshot. Embedding more documents here will not change
              what this image answers from — deploy again to pick them up.
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {result ? 'Done' : 'Cancel'}
        </Button>
        {!result && (
          <Button variant="contained" disabled={busy} onClick={() => onDeploy(build)}>
            Deploy
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/** A shell command, with the copy button that is the point of showing it. */
function Command({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Box>
      <Box className="flex items-center justify-between">
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <IconButton
            size="small"
            aria-label={`Copy: ${label}`}
            onClick={() => {
              void navigator.clipboard?.writeText(text)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }}
          >
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          borderRadius: 1,
          bgcolor: 'action.hover',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          overflowX: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </Box>
    </Box>
  )
}
