import {
  Box,
  Button,
  Divider,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import type { FlowFile, FlowNode, Source, SourceType, WidgetConfig } from '../../lib/types'
import { formatCount, totalChunks } from '../../lib/utils'
import { SOURCE_TYPES, WIDGETS } from './widgets'

/** Passage budgets offered, matching the chat pane's own list. */
const TOP_K_CHOICES = [3, 4, 6, 8, 10, 15, 20]

interface WidgetInspectorProps {
  node: FlowNode | null
  sources: Source[]
  /** Flows an Agent widget may call — every file but the one being edited. */
  flows: FlowFile[]
  openFlow: string
  onChange: (config: WidgetConfig) => void
  onDelete: () => void
}

/**
 * Settings for the selected widget.
 *
 * The widgets on the canvas stay small enough to wire; everything editable
 * lives here. Each kind renders only the fields its `WidgetConfig` uses.
 */
export function WidgetInspector({
  node,
  sources,
  flows,
  openFlow,
  onChange,
  onDelete,
}: WidgetInspectorProps) {
  if (!node) return null

  const spec = WIDGETS[node.kind]
  const sourceType: SourceType = node.config.sourceType ?? 'files'

  return (
    <Box className="flex flex-col">
      <Box className="px-3 pt-2.5 pb-2">
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
        >
          {spec.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {spec.blurb}
        </Typography>
      </Box>
      <Divider />

      <Box className="flex flex-col gap-3 p-3">
        {node.kind === 'source' && (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              fullWidth
              value={sourceType}
              onChange={(_, next: SourceType | null) =>
                next && onChange({ ...node.config, sourceType: next })
              }
            >
              {SOURCE_TYPES.map((one) => (
                <ToggleButton key={one.value} value={one.value} sx={{ py: 0.5 }}>
                  {one.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              {SOURCE_TYPES.find((one) => one.value === sourceType)?.blurb}
            </Typography>

            {sourceType === 'files' && (
              <TextField
                select
                label="Source"
                value={
                  sources.some((one) => one.id === node.config.sourceId)
                    ? node.config.sourceId
                    : ''
                }
                onChange={(event) => onChange({ ...node.config, sourceId: event.target.value })}
                helperText={
                  sources.length === 0
                    ? 'No sources yet — upload documents in Embed Documents.'
                    : ' '
                }
              >
                {sources.map((source) => (
                  <MenuItem
                    key={source.id}
                    value={source.id}
                    disabled={totalChunks(source.documents) === 0}
                  >
                    {source.name} · {formatCount(totalChunks(source.documents))} vectors
                  </MenuItem>
                ))}
              </TextField>
            )}

            {sourceType === 'txt' && (
              <>
                <TextField
                  label="Label"
                  value={node.config.label ?? ''}
                  onChange={(event) => onChange({ ...node.config, label: event.target.value })}
                  placeholder="Note"
                  helperText="What this passage is called in a citation."
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                />
                <TextField
                  multiline
                  minRows={6}
                  maxRows={16}
                  label="Text"
                  value={node.config.text ?? ''}
                  onChange={(event) => onChange({ ...node.config, text: event.target.value })}
                  placeholder="Text put in front of the model exactly as written…"
                  slotProps={{ htmlInput: { maxLength: 20_000 } }}
                />
              </>
            )}

            {sourceType === 'chat' && (
              <Typography variant="body2" color="text.secondary">
                The conversation so far is put in front of the model, so it can refer back to
                what was already said. Nothing to configure.
              </Typography>
            )}
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <TextField
              select
              label="Flow to run"
              value={flows.some((one) => one.name === node.config.flow) ? node.config.flow : ''}
              onChange={(event) => onChange({ ...node.config, flow: event.target.value })}
              helperText={
                flows.length <= 1
                  ? 'Create another flow first — an agent runs one.'
                  : 'It answers the same question, and its answer arrives here as a passage.'
              }
            >
              {flows
                // A flow calling itself is a loop the backend refuses, so it is
                // not offered in the first place.
                .filter((one) => one.name !== openFlow)
                .map((one) => (
                  <MenuItem key={one.name} value={one.name}>
                    {one.name}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label="Label"
              value={node.config.label ?? ''}
              onChange={(event) => onChange({ ...node.config, label: event.target.value })}
              placeholder={node.config.flow ?? 'Agent'}
              helperText="What its answer is called in a citation."
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
          </>
        )}

        {node.kind === 'system' && (
          <TextField
            multiline
            minRows={6}
            maxRows={16}
            label="System message"
            value={node.config.system ?? ''}
            onChange={(event) => onChange({ ...node.config, system: event.target.value })}
            placeholder="You are a careful research assistant…"
            slotProps={{ htmlInput: { maxLength: 20_000 } }}
          />
        )}

        {node.kind === 'retrieval' && (
          <TextField
            select
            label="Passages per question"
            value={node.config.topK ?? 6}
            onChange={(event) => onChange({ ...node.config, topK: Number(event.target.value) })}
          >
            {TOP_K_CHOICES.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {choice}
              </MenuItem>
            ))}
          </TextField>
        )}

        {node.kind === 'answer' && (
          <Typography variant="body2" color="text.secondary">
            Everything wired into this widget is what a question sees. It has nothing to
            configure — the conversation itself happens in Chat.
          </Typography>
        )}

        <Box>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlinedIcon fontSize="small" />}
            onClick={onDelete}
          >
            Remove widget
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
