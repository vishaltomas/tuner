import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Paper, Snackbar, Typography } from '@mui/material'
import { useBackendStatus } from '../../hooks/useBackendStatus'
import type { Source } from '../../lib/types'
import { formatCount, totalChunks } from '../../lib/utils'
import { MergeDialog } from './MergeDialog'
import { SourceList } from './SourceList'
import { UploadForm, type UploadSubmit } from './UploadForm'

interface EmbedSectionProps {
  sources: Source[]
  loading: boolean
  embed: (input: UploadSubmit) => Promise<Source>
  merge: (sourceIds: string[], name: string, keepOriginals: boolean) => Promise<Source>
  removeSource: (sourceId: string) => Promise<void>
  removeDocument: (sourceId: string, documentId: string) => Promise<void>
}

type Notice = { tone: 'success' | 'error'; text: string } | null

export function EmbedDocumentsSection({
  sources,
  loading,
  embed,
  merge,
  removeSource,
  removeDocument,
}: EmbedSectionProps) {
  const status = useBackendStatus()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  // Drop selections whose source is gone, so a stale id cannot reach a merge.
  useEffect(() => {
    setSelectedIds((previous) =>
      previous.filter((id) => sources.some((source) => source.id === id)),
    )
  }, [sources])

  const stats = useMemo(() => {
    const documents = sources.reduce((sum, source) => sum + source.documents.length, 0)
    const vectors = sources.reduce((sum, source) => sum + totalChunks(source.documents), 0)
    const models = new Set(sources.map((source) => source.model))
    return [
      { label: 'Sources', value: formatCount(sources.length) },
      { label: 'Documents', value: formatCount(documents) },
      { label: 'Vectors stored', value: formatCount(vectors) },
      { label: 'Models in use', value: formatCount(models.size) },
    ]
  }, [sources])

  const selected = sources.filter((source) => selectedIds.includes(source.id))

  async function handleUpload(input: UploadSubmit) {
    setBusy(true)
    try {
      const source = await embed(input)
      setNotice({
        tone: 'success',
        text: `Embedding ${input.files.length} ${
          input.files.length === 1 ? 'document' : 'documents'
        } into “${source.name}”.`,
      })
    } catch {
      setNotice({ tone: 'error', text: 'Could not start the embedding job. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleMerge(name: string, keepOriginals: boolean) {
    setBusy(true)
    try {
      await merge(selectedIds, name, keepOriginals)
      setNotice({ tone: 'success', text: `Merged ${selectedIds.length} sources into “${name}”.` })
      setSelectedIds([])
      setMergeOpen(false)
    } catch {
      setNotice({ tone: 'error', text: 'Could not merge those sources.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 lg:p-7">
      <Box component="header">
        <Typography variant="h1">Embed Documents</Typography>
        <Typography variant="body2" color="text.secondary" className="mt-1">
          Upload PDFs and text files, turn them into vectors with a Hugging Face embedding model,
          and store them under a named source.
        </Typography>
      </Box>

      {status === 'offline' && (
        <Alert severity="warning">
          The embedding backend at <code>/api</code> is not responding. You can still set sources up
          here — they are kept in this browser and are not written to the vector store yet.
        </Alert>
      )}

      <Box component="dl" className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Paper key={stat.label} variant="outlined" className="px-4 py-3" sx={{ borderRadius: 3 }}>
            <Typography component="dt" variant="caption" color="text.secondary">
              {stat.label}
            </Typography>
            <Typography component="dd" variant="h6" className="m-0 tabular-nums">
              {stat.value}
            </Typography>
          </Paper>
        ))}
      </Box>

      <UploadForm sources={sources} busy={busy} onSubmit={handleUpload} />

      <SourceList
        sources={sources}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelected={(sourceId) =>
          setSelectedIds((previous) =>
            previous.includes(sourceId)
              ? previous.filter((id) => id !== sourceId)
              : [...previous, sourceId],
          )
        }
        onClearSelection={() => setSelectedIds([])}
        onMerge={() => setMergeOpen(true)}
        onDeleteSource={(sourceId) => void removeSource(sourceId)}
        onDeleteDocument={(sourceId, documentId) => void removeDocument(sourceId, documentId)}
      />

      <MergeDialog
        open={mergeOpen}
        selected={selected}
        busy={busy}
        onClose={() => setMergeOpen(false)}
        onMerge={handleMerge}
      />

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4500}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.tone === 'error' ? 'error' : 'success'}
          variant="outlined"
          onClose={() => setNotice(null)}
          sx={{ bgcolor: 'background.paper' }}
        >
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  )
}
