import { Box, Button, LinearProgress, Typography } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import { useModelDownload } from '../../hooks/useModelDownload'
import { formatBytes } from '../../lib/utils'

interface ModelDownloadProps {
  modelId: string
  disabled?: boolean
}

const LABELS: Record<string, string> = {
  queued: 'Queued…',
  running: 'Downloading…',
  succeeded: 'Downloaded',
  failed: 'Download failed',
}

/**
 * Fetch the selected model to the server, and show how far it has got.
 *
 * Embedding does not require this — the backend registers whatever model a
 * source names — so this is an explicit action rather than something the
 * upload waits on.
 */
export function ModelDownload({ modelId, disabled }: ModelDownloadProps) {
  const { job, start, starting, supported, localSize } = useModelDownload(modelId)

  if (!supported) {
    return (
      <Typography variant="caption" color="text.secondary">
        Model downloads are not available on this backend.
      </Typography>
    )
  }

  const running = job !== null && (job.status === 'queued' || job.status === 'running')
  const failed = job?.status === 'failed'
  // A finished job is the fresher truth; otherwise fall back to what the
  // catalogue said when the picker last changed.
  const onDisk = job?.status === 'succeeded' || (job === null && localSize !== null)

  const percent =
    job && job.totalBytes ? Math.min(100, (job.downloadedBytes / job.totalBytes) * 100) : null

  if (onDisk) {
    return (
      <Box className="flex items-center gap-1.5">
        <CheckCircleOutlineIcon fontSize="small" color="success" />
        <Typography variant="caption" color="text.secondary">
          On disk{localSize ? ` · ${formatBytes(localSize)}` : ''}
        </Typography>
      </Box>
    )
  }

  if (running) {
    return (
      <Box className="flex flex-col gap-1">
        <LinearProgress
          variant={percent === null ? 'indeterminate' : 'determinate'}
          value={percent ?? undefined}
        />
        <Typography variant="caption" color="text.secondary">
          {LABELS[job.status]}
          {job.totalBytes
            ? ` ${formatBytes(job.downloadedBytes)} of ${formatBytes(job.totalBytes)}`
            : ''}
          {percent === null ? '' : ` · ${Math.round(percent)}%`}
        </Typography>
      </Box>
    )
  }

  return (
    <Box className="flex items-center gap-2">
      <Button
        size="small"
        variant="outlined"
        startIcon={<DownloadOutlinedIcon />}
        disabled={disabled || starting || !modelId}
        onClick={() => void start()}
      >
        {failed ? 'Try again' : 'Download model'}
      </Button>
      {failed && (
        <Box className="flex items-center gap-1 min-w-0">
          <ErrorOutlineIcon fontSize="small" color="error" />
          <Typography variant="caption" color="error" className="truncate" title={job.error ?? ''}>
            {job.error ?? LABELS.failed}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
