import {
  Autocomplete,
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import type {
  FlowFile,
  FlowNode,
  IoMode,
  LocalModel,
  PayloadType,
  RetrievalMethod,
  Source,
  SourceType,
  WidgetConfig,
} from '../../lib/types'
import { totalChunks } from '../../lib/utils'
import {
  IO_MODES,
  PAYLOAD_TYPES,
  RETRIEVAL_METHODS,
  SOURCE_TYPES,
  WIDGETS,
} from './widgets'

/** How many passages a Source may retrieve, and a Reranker may keep. */
const COUNTS = [3, 4, 6, 8, 10, 15, 20, 30, 50]

/**
 * Rerankers that are not embedding models, offered before the local list has
 * anything in it. Cross-encoders are a different kind of model from the ones
 * Embed Documents downloads, so the field stays free text — this is a nudge,
 * not a menu.
 */
const RERANKERS = [
  'cross-encoder/ms-marco-MiniLM-L-6-v2',
  'cross-encoder/ms-marco-MiniLM-L-12-v2',
  'BAAI/bge-reranker-base',
  'BAAI/bge-reranker-v2-m3',
  'mixedbread-ai/mxbai-rerank-base-v1',
]

/**
 * Chat models offered to a Router, smallest first.
 *
 * Deciding a branch is a one-token classification, so the model worth
 * spending on it is rarely the one worth spending on the answer — which is
 * why it is the Router's own property rather than the app's setting.
 */
const ROUTER_MODELS = [
  'meta-llama/Llama-3.2-3B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'Qwen/Qwen2.5-7B-Instruct',
]

interface WidgetInspectorProps {
  node: FlowNode | null
  sources: Source[]
  /** Models on disk, offered to the Embed and Reranker widgets. */
  models: LocalModel[]
  /** Flows an Agent widget may call — every file but the one being edited. */
  flows: FlowFile[]
  openFlow: string
  isMain: boolean
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
  models,
  flows,
  openFlow,
  isMain,
  onChange,
  onDelete,
}: WidgetInspectorProps) {
  if (!node) return null

  const spec = WIDGETS[node.kind]
  const config = node.config
  const set = (patch: Partial<WidgetConfig>) => onChange({ ...config, ...patch })

  const isEnd = node.kind === 'input' || node.kind === 'output'
  const mode: IoMode = config.mode ?? 'chat'
  const sourceType: SourceType = config.sourceType ?? 'files'
  const picked = config.sourceIds ?? []

  return (
    <Box
      className="flex flex-col"
      sx={{
        // MUI's `size="small"` tightens padding but leaves the text at 16px,
        // which sat oddly against the 12px labels and helper text around it.
        // Setting it here rather than on each field keeps the panel one scale
        // as widgets are added.
        '& .MuiInputBase-input, & .MuiInputLabel-root': { fontSize: 14 },
        '& .MuiInputLabel-shrink': { fontSize: 12 },
        '& .MuiMenuItem-root': { fontSize: 14 },
        '& .MuiToggleButton-root': { fontSize: 13 },
      }}
    >
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
        {isEnd && (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              fullWidth
              value={mode}
              // main.flow is what Chat runs, so its two ends are the
              // conversation and there is nothing to choose.
              disabled={isMain}
              onChange={(_, next: IoMode | null) => next && set({ mode: next })}
            >
              {IO_MODES.map((one) => (
                <ToggleButton key={one.value} value={one.value} sx={{ py: 0.5 }}>
                  {one.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              {isMain
                ? 'main.flow is what Chat runs, so both ends are the conversation.'
                : mode === 'chat'
                  ? 'The question comes in and the answer goes back as conversation.'
                  : 'Text with a declared extension, handed to and from the Agent widget that runs this flow.'}
            </Typography>

            {mode === 'payload' && !isMain && (
              <TextField
                select
                label="Payload type"
                value={config.payloadType ?? 'txt'}
                onChange={(event) =>
                  set({ payloadType: event.target.value as PayloadType })
                }
                helperText={
                  node.kind === 'output'
                    ? 'The model is told to produce this kind of text.'
                    : 'What this flow expects to be handed.'
                }
              >
                {PAYLOAD_TYPES.map((one) => (
                  <MenuItem key={one} value={one}>
                    .{one}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </>
        )}

        {node.kind === 'source' && (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              fullWidth
              value={sourceType}
              onChange={(_, next: SourceType | null) => next && set({ sourceType: next })}
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
              <>
                <Autocomplete
                  multiple
                  size="small"
                  options={sources.filter((one) => totalChunks(one.documents) > 0)}
                  getOptionLabel={(one) => one.name}
                  value={sources.filter((one) => picked.includes(one.id))}
                  onChange={(_, next) => set({ sourceIds: next.map((one) => one.id) })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Sources"
                      helperText={
                        sources.length === 0
                          ? 'No sources yet — upload documents in Embed Documents.'
                          : 'Searched together as one pool, so the budget goes to the best passages across all of them.'
                      }
                    />
                  )}
                />

                <TextField
                  select
                  label="Retrieval method"
                  value={config.method ?? 'similarity'}
                  onChange={(event) =>
                    set({ method: event.target.value as RetrievalMethod })
                  }
                  helperText={
                    RETRIEVAL_METHODS.find(
                      (one) => one.value === (config.method ?? 'similarity'),
                    )?.blurb
                  }
                >
                  {RETRIEVAL_METHODS.map((one) => (
                    <MenuItem key={one.value} value={one.value}>
                      {one.label}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  select
                  label="Number of documents"
                  value={config.docs ?? 6}
                  onChange={(event) => set({ docs: Number(event.target.value) })}
                >
                  {COUNTS.map((one) => (
                    <MenuItem key={one} value={one}>
                      {one}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}

            {sourceType === 'txt' && (
              <>
                <TextField
                  label="Label"
                  value={config.label ?? ''}
                  onChange={(event) => set({ label: event.target.value })}
                  placeholder="Note"
                  helperText="What this passage is called in a citation."
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                />
                <TextField
                  multiline
                  minRows={5}
                  maxRows={14}
                  label="Text"
                  value={config.text ?? ''}
                  onChange={(event) => set({ text: event.target.value })}
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

        {node.kind === 'embed' && (
          <Autocomplete
            freeSolo
            size="small"
            options={models.map((one) => one.id)}
            value={config.model ?? ''}
            onChange={(_, next) => set({ model: next ?? '' })}
            onInputChange={(_, next) => set({ model: next })}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Embedding model"
                helperText="Leave blank to use whatever model its sources were embedded with — the only answer that can be right. Name one to say so deliberately."
              />
            )}
          />
        )}

        {node.kind === 'reranker' && (
          <>
            <Autocomplete
              freeSolo
              size="small"
              options={RERANKERS}
              value={config.model ?? ''}
              onChange={(_, next) => set({ model: next ?? '' })}
              onInputChange={(_, next) => set({ model: next })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Reranker model"
                  helperText="A cross-encoder. It reads the question and each passage together, which is slower but far better at ranking than the vector search that produced them."
                />
              )}
            />
            <TextField
              select
              label="Keep after reranking"
              value={config.keep ?? ''}
              onChange={(event) =>
                set({ keep: event.target.value ? Number(event.target.value) : undefined })
              }
              helperText="Retrieve broadly, then keep the best few."
            >
              <MenuItem value="">
                <em>Keep all, reordered</em>
              </MenuItem>
              {COUNTS.map((one) => (
                <MenuItem key={one} value={one}>
                  {one}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}

        {node.kind === 'router' && (
          <>
            <Autocomplete
              freeSolo
              size="small"
              options={ROUTER_MODELS}
              value={config.model ?? ''}
              onChange={(_, next) => set({ model: next ?? '' })}
              onInputChange={(_, next) => set({ model: next })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Deciding model"
                  helperText="The model that picks the branch. Blank uses the app's chat model — this is a one-token classification, so a small model usually does it as well as a large one."
                />
              )}
            />

            <Typography variant="caption" color="text.secondary">
              Each route is an output on the widget. Exactly one is taken; the
              branches below the others are skipped entirely.
            </Typography>

            {(config.routes ?? []).map((route, index) => (
              <Box
                key={route.id}
                className="flex flex-col gap-2 rounded p-2"
                sx={{ border: 1, borderColor: 'divider' }}
              >
                <Box className="flex items-center gap-1">
                  <TextField
                    label={`Route ${index + 1}`}
                    value={route.label}
                    onChange={(event) =>
                      set({
                        routes: (config.routes ?? []).map((one) =>
                          one.id === route.id ? { ...one, label: event.target.value } : one,
                        ),
                      })
                    }
                    slotProps={{ htmlInput: { maxLength: 40 } }}
                  />
                  <Tooltip
                    title={
                      (config.routes ?? []).length <= 2
                        ? 'A Router needs at least two routes'
                        : `Remove ${route.label || 'this route'}`
                    }
                  >
                    <Box>
                      <IconButton
                        size="small"
                        aria-label={`Remove route ${index + 1}`}
                        disabled={(config.routes ?? []).length <= 2}
                        onClick={() =>
                          set({
                            routes: (config.routes ?? []).filter(
                              (one) => one.id !== route.id,
                            ),
                          })
                        }
                      >
                        <DeleteOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Tooltip>
                </Box>
                <TextField
                  multiline
                  minRows={2}
                  maxRows={5}
                  label="When to take it"
                  value={route.when}
                  placeholder="questions about patient care, drugs or procedures"
                  onChange={(event) =>
                    set({
                      routes: (config.routes ?? []).map((one) =>
                        one.id === route.id ? { ...one, when: event.target.value } : one,
                      ),
                    })
                  }
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
              </Box>
            ))}

            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={() =>
                set({
                  routes: [
                    ...(config.routes ?? []),
                    { id: `r${Date.now().toString(36)}`, label: '', when: '' },
                  ],
                })
              }
            >
              Add route
            </Button>
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <TextField
              select
              label="Flow to run"
              value={flows.some((one) => one.name === config.flow) ? config.flow : ''}
              onChange={(event) => set({ flow: event.target.value })}
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
              value={config.label ?? ''}
              onChange={(event) => set({ label: event.target.value })}
              placeholder={config.flow ?? 'Agent'}
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
            value={config.system ?? ''}
            onChange={(event) => set({ system: event.target.value })}
            placeholder="You are a careful research assistant…"
            slotProps={{ htmlInput: { maxLength: 20_000 } }}
          />
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
