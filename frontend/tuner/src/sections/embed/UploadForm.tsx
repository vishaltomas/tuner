import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormLabel,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import { FALLBACK_MODELS } from '../../lib/api'
import type { Source } from '../../lib/types'
import { formatBytes } from '../../lib/utils'
import { EmbeddingModelPicker } from './EmbeddingModelPicker'
import { FileDropzone } from './FileDropzone'

type Destination = 'new' | 'existing'

export interface UploadSubmit {
  sourceId: string | null
  name: string
  description?: string
  model: string
  files: File[]
}

interface UploadFormProps {
  sources: Source[]
  busy: boolean
  onSubmit: (input: UploadSubmit) => Promise<void>
}

export function UploadForm({ sources, busy, onSubmit }: UploadFormProps) {
  const [destination, setDestination] = useState<Destination>('new')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState(FALLBACK_MODELS[0].id)
  const [targetId, setTargetId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const target = sources.find((source) => source.id === targetId)
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])

  // Appending to a source has to reuse its model — vectors from two different
  // models are not comparable, so mixing them inside one source breaks search.
  const effectiveModel = destination === 'existing' ? (target?.model ?? '') : model

  function validate(): boolean {
    const next: Record<string, string> = {}

    if (destination === 'new') {
      if (!name.trim()) next.name = 'Give this upload session a name.'
      else if (sources.some((source) => source.name.toLowerCase() === name.trim().toLowerCase()))
        next.name = 'A source with that name already exists.'
      if (!model) next.model = 'Choose an embedding model.'
    } else if (!targetId) {
      next.target = 'Choose the source to add these documents to.'
    }

    if (files.length === 0) next.files = 'Add at least one PDF or TXT file.'

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return

    await onSubmit({
      sourceId: destination === 'existing' ? targetId : null,
      name: destination === 'existing' ? (target?.name ?? '') : name.trim(),
      description: description.trim() || undefined,
      model: effectiveModel,
      files,
    })

    setFiles([])
    setErrors({})
    if (destination === 'new') {
      setName('')
      setDescription('')
    }
  }

  return (
    <Card>
      <CardHeader
        title="Embed documents"
        subheader="Upload PDFs or text files, pick a model, and store the vectors."
      />
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <Box className="flex flex-col gap-2">
          <FormLabel required error={Boolean(errors.files)}>
            Documents
          </FormLabel>
          <FileDropzone files={files} onChange={setFiles} disabled={busy} />
          {errors.files && (
            <Typography variant="caption" color="error">
              {errors.files}
            </Typography>
          )}
          {files.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}{' '}
              queued
            </Typography>
          )}
        </Box>

        <Box className="flex flex-col gap-4">
          <Box className="flex flex-col gap-1.5">
            <FormLabel>Destination</FormLabel>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              color="primary"
              value={destination}
              onChange={(_, next: Destination | null) => next && setDestination(next)}
            >
              <ToggleButton value="new" disabled={busy}>
                New source
              </ToggleButton>
              <ToggleButton value="existing" disabled={busy || sources.length === 0}>
                Add to existing
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {destination === 'new' ? (
            <>
              <TextField
                required
                label="Source name"
                placeholder="e.g. Product handbook Q3"
                value={name}
                disabled={busy}
                error={Boolean(errors.name)}
                helperText={
                  errors.name ?? 'Names this upload session, and groups its documents in the store.'
                }
                onChange={(event) => setName(event.target.value)}
              />

              <TextField
                label="Description"
                placeholder="Optional note about what these documents cover"
                multiline
                rows={2}
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />

              <Box className="flex flex-col gap-1.5">
                <FormLabel required error={Boolean(errors.model)}>
                  Embedding model
                </FormLabel>
                <EmbeddingModelPicker
                  value={model}
                  onChange={setModel}
                  disabled={busy}
                  error={errors.model}
                />
                <Typography variant="caption" color="text.secondary">
                  Every document in this source is embedded with this model.
                </Typography>
              </Box>
            </>
          ) : (
            <>
              <TextField
                select
                required
                label="Target source"
                value={targetId}
                disabled={busy}
                error={Boolean(errors.target)}
                helperText={errors.target}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <MenuItem value="">
                  <em>Select a source…</em>
                </MenuItem>
                {sources.map((source) => (
                  <MenuItem key={source.id} value={source.id}>
                    {source.name} ({source.documents.length}{' '}
                    {source.documents.length === 1 ? 'doc' : 'docs'})
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Embedding model"
                value={target?.model ?? '—'}
                disabled
                sx={{ '& input': { fontFamily: 'var(--font-mono)', fontSize: 13 } }}
              />

              <Alert severity="info">
                New documents reuse the model this source was created with, so its vectors stay
                comparable.
              </Alert>
            </>
          )}

          <Box className="mt-auto flex justify-end pt-2">
            <Button
              variant="contained"
              loading={busy}
              loadingPosition="start"
              startIcon={<UploadFileOutlinedIcon />}
              onClick={handleSubmit}
            >
              {busy
                ? 'Embedding…'
                : files.length > 0
                  ? `Embed ${files.length} ${files.length === 1 ? 'document' : 'documents'}`
                  : 'Embed documents'}
            </Button>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
