import { Alert, Box, Button, Card, Chip, Typography } from '@mui/material'
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined'
import { useBackendStatus } from '../../hooks/useBackendStatus'
import { useChat } from '../../hooks/useChat'
import type { Source, Workflow } from '../../lib/types'
import { totalChunks } from '../../lib/utils'
import { ChatComposer } from './ChatComposer'
import { ChatSettings } from './ChatSettings'
import { WorkflowPicker } from './WorkflowPicker'
import { ChatTranscript } from './ChatTranscript'

interface ChatSectionProps {
  sources: Source[]
  workflows: Workflow[]
  reembed: (sourceId: string) => Promise<void>
}

export function ChatSection({ sources, workflows, reembed }: ChatSectionProps) {
  const status = useBackendStatus()
  const chat = useChat(sources)

  // Whatever the next question will run with — the workflow's sources when one
  // is linked, the hand-picked ones otherwise.
  const selected = sources.filter((source) => chat.active.sourceIds.includes(source.id))
  const vectors = selected.reduce((sum, source) => sum + totalChunks(source.documents), 0)

  // Why the composer is closed, if it is. Ordered by what the user should fix
  // first: without a backend nothing works, and without vectors there is
  // nothing for a question to be answered from.
  const blockedReason =
    status === 'offline'
      ? 'The backend is not answering, so questions cannot be sent.'
      : chat.workflow
        ? null
        : selected.length === 0
          ? 'Select a source to ask about.'
          : vectors === 0
            ? 'The selected sources have no vectors yet.'
            : null

  return (
    <Box className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 p-5 lg:p-7">
      <Box component="header">
        <Typography variant="h1">Chat</Typography>
        <Typography variant="body2" color="text.secondary" className="mt-1">
          Ask questions of your embedded documents. Passages are retrieved from the vectors you
          stored, and the answer is written from those alone — with citations back to them.
        </Typography>
      </Box>

      {status === 'offline' && (
        <Alert severity="warning">
          The backend at <code>/api</code> is not responding. Retrieval and answering both run
          there, so chat is unavailable until it is back.
        </Alert>
      )}

      {/* Below `lg` the two panes stack and the page scrolls; from `lg` they
          sit side by side at a fixed height, each scrolling its own content. */}
      <Box className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <Card className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
          <Box
            className="flex items-center justify-between gap-2 border-b px-4 py-2"
            sx={{ borderColor: 'divider' }}
          >
            <Box className="flex min-w-0 flex-wrap items-center gap-1.5">
              {chat.workflow ? (
                <Chip label={chat.workflow} color="success" variant="outlined" />
              ) : selected.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No source selected
                </Typography>
              ) : (
                selected.map((source) => (
                  <Chip key={source.id} label={source.name} variant="outlined" />
                ))
              )}
            </Box>
            <Button
              size="small"
              color="inherit"
              startIcon={<DeleteSweepOutlinedIcon fontSize="small" />}
              disabled={chat.turns.length === 0 || chat.busy}
              onClick={chat.clear}
            >
              Clear
            </Button>
          </Box>

          <ChatTranscript
            turns={chat.turns}
            busy={chat.busy}
            hasSources={selected.length > 0 && vectors > 0}
          />

          <ChatComposer
            busy={chat.busy}
            blockedReason={blockedReason}
            onSend={(message) => void chat.send(message)}
          />
        </Card>

        <Box className="flex w-full shrink-0 flex-col gap-4 lg:w-80 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <WorkflowPicker
            workflows={workflows}
            workflow={chat.workflow}
            onPick={chat.setWorkflow}
          />

          {/* Only for the fallback: a workflow owns the sources, the system
              message and the passage budget, and a second editable copy here
              would leave which one ran a question unclear. */}
          {!chat.workflow && (
            <ChatSettings
              sources={sources}
              defaults={chat.defaults}
              sourceIds={chat.sourceIds}
              onToggleSource={chat.toggleSource}
              system={chat.system}
              onSystemChange={chat.setSystem}
              onResetSystem={chat.resetSystem}
              topK={chat.topK}
              onTopKChange={chat.setTopK}
              onReembed={(sourceId) => void reembed(sourceId)}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
}
