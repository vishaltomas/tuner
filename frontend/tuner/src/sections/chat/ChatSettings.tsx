import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import type { ChatDefaults, Source } from '../../lib/types'
import { formatCount, totalChunks } from '../../lib/utils'

/** Passage budgets offered per question. */
const TOP_K_CHOICES = [3, 4, 6, 8, 10, 15, 20]

interface ChatSettingsProps {
  sources: Source[]
  defaults: ChatDefaults
  sourceIds: string[]
  onToggleSource: (sourceId: string) => void
  system: string
  onSystemChange: (value: string) => void
  onResetSystem: () => void
  topK: number
  onTopKChange: (value: number) => void
  onReembed: (sourceId: string) => void
}

export function ChatSettings({
  sources,
  defaults,
  sourceIds,
  onToggleSource,
  system,
  onSystemChange,
  onResetSystem,
  topK,
  onTopKChange,
  onReembed,
}: ChatSettingsProps) {
  // Every source in one question has to share an embedding model: a question
  // is embedded once, and that vector only means anything in the space its
  // passages were put in. Locking the others out here is friendlier than
  // letting the backend refuse the question afterwards.
  const model = sources.find((source) => sourceIds.includes(source.id))?.model ?? null

  return (
    // Rendered inside the chat rail, which owns the width and the scroll.
    // Each card keeps `shrink-0` so it is not squeezed below its own content:
    // the inner scroll areas make their min-content height small enough that
    // the browser would otherwise be free to clip them.
    <Box className="flex flex-col gap-4">
      <Card className="shrink-0">
        <CardHeader
          title="Sources"
          subheader={
            model
              ? 'Only sources sharing this embedding model can be asked together.'
              : 'Pick the knowledge base to answer from.'
          }
        />
        <CardContent sx={{ p: 0 }}>
          {sources.length === 0 ? (
            <Typography variant="body2" color="text.secondary" className="px-4 py-6 text-center">
              No sources yet. Upload documents in Embed Documents first.
            </Typography>
          ) : (
            <Box className="flex max-h-72 flex-col overflow-y-auto px-2 py-1">
              {sources.map((source) => {
                const vectors = totalChunks(source.documents)
                const wrongModel = model !== null && source.model !== model
                const pending = source.documents.some(
                  (doc) => doc.status === 'queued' || doc.status === 'embedding',
                )

                return (
                  <Box key={source.id} className="px-1">
                    <Tooltip
                      title={
                        wrongModel
                          ? `Embedded with ${source.model}, not ${model}`
                          : vectors === 0
                            ? 'Nothing embedded in this source yet'
                            : ''
                      }
                      placement="left"
                    >
                      {/* A disabled control fires no events, so the tooltip
                          needs a wrapper that is still hoverable. */}
                      <Box>
                        <FormControlLabel
                          disabled={wrongModel || vectors === 0}
                          sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                          control={
                            <Checkbox
                              size="small"
                              checked={sourceIds.includes(source.id)}
                              onChange={() => onToggleSource(source.id)}
                            />
                          }
                          label={
                            <Box className="min-w-0 py-1">
                              <Typography variant="body2" noWrap>
                                {source.name}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="p"
                                className="flex flex-wrap items-center gap-x-1.5"
                              >
                                <span>{formatCount(vectors)} vectors</span>
                                <span>·</span>
                                <Box
                                  component="span"
                                  sx={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                                >
                                  {source.model}
                                </Box>
                              </Typography>
                              {pending && (
                                <Chip
                                  label="embedding"
                                  color="primary"
                                  variant="outlined"
                                  className="mt-1"
                                />
                              )}
                            </Box>
                          }
                        />
                      </Box>
                    </Tooltip>

                    {vectors === 0 && !pending && (
                      <Button
                        size="small"
                        startIcon={<RestartAltIcon fontSize="small" />}
                        onClick={() => onReembed(source.id)}
                        sx={{ ml: 3.5, mb: 1 }}
                      >
                        Embed its documents
                      </Button>
                    )}
                  </Box>
                )
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader
          title="System message"
          subheader="Standing instructions sent ahead of every question."
        />
        <CardContent className="flex flex-col gap-3">
          <TextField
            multiline
            minRows={5}
            maxRows={14}
            value={system}
            onChange={(event) => onSystemChange(event.target.value)}
            placeholder={defaults.system}
            slotProps={{ htmlInput: { maxLength: 20_000, 'aria-label': 'System message' } }}
          />
          <Typography variant="caption" color="text.secondary">
            Yours is sent first, unchanged. The rules that keep answers inside the retrieved
            passages — and citing them — are appended by the backend and are not editable.
          </Typography>
          <Box>
            <Button
              size="small"
              startIcon={<RestartAltIcon fontSize="small" />}
              onClick={onResetSystem}
              disabled={system === defaults.system}
            >
              Reset to default
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader title="Retrieval" subheader="How much of the corpus each answer sees." />
        <CardContent className="flex flex-col gap-3">
          <TextField
            select
            label="Passages per question"
            value={topK}
            onChange={(event) => onTopKChange(Number(event.target.value))}
          >
            {TOP_K_CHOICES.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {choice}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            Answers are written by{' '}
            <Box component="span" sx={{ fontFamily: 'var(--font-mono)' }}>
              {defaults.model}
            </Box>{' '}
            on the Hugging Face Inference API. Retrieval runs locally against the vectors in
            Postgres.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
