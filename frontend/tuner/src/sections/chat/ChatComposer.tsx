import { useState } from 'react'
import { Box, IconButton, TextField, Tooltip, Typography } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'

interface ChatComposerProps {
  busy: boolean
  /** Empty until a source is picked; the reason is shown in place of the hint. */
  blockedReason: string | null
  onSend: (message: string) => void
}

export function ChatComposer({ busy, blockedReason, onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const disabled = busy || blockedReason !== null
  const canSend = draft.trim().length > 0 && !disabled

  function submit() {
    if (!canSend) return
    onSend(draft)
    setDraft('')
  }

  return (
    <Box className="flex flex-col gap-1.5 border-t p-3" sx={{ borderColor: 'divider' }}>
      <Box className="flex items-end gap-2">
        <TextField
          multiline
          maxRows={8}
          value={draft}
          disabled={disabled}
          placeholder={blockedReason ?? 'Ask a question about the selected sources…'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. `isComposing` guards
            // an IME: mid-composition Enter commits a candidate word and must
            // not post a half-typed question.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          slotProps={{ htmlInput: { maxLength: 20_000, 'aria-label': 'Message' } }}
        />
        <Tooltip title={canSend ? 'Send' : ''}>
          <Box>
            <IconButton color="primary" aria-label="Send" disabled={!canSend} onClick={submit}>
              <SendIcon fontSize="small" />
            </IconButton>
          </Box>
        </Tooltip>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Enter sends · Shift+Enter for a new line
      </Typography>
    </Box>
  )
}
