import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'

interface NameDialogProps {
  open: boolean
  title: string
  label: string
  /** What the field starts with, and what Cancel returns to. */
  initial: string
  submitLabel: string
  /** Why this name cannot be used, shown under the field as you type. */
  validate?: (name: string) => string | null
  onSubmit: (name: string) => void
  onClose: () => void
}

/**
 * Asking for a name.
 *
 * A real dialog rather than `window.prompt`, which browsers suppress after a
 * page has shown a few — Chrome offers "prevent this page from creating
 * additional dialogs", and from then on the call returns `null`, which is
 * indistinguishable from Cancel. Creating a flow would silently do nothing.
 *
 * It also lets the name be checked as it is typed, so a name that would be
 * refused says so here rather than coming back as a failed request.
 */
export function NameDialog({
  open,
  title,
  label,
  initial,
  submitLabel,
  validate,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [value, setValue] = useState(initial)

  // Reset each time it opens: the previous answer is not a sensible starting
  // point for the next question.
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])

  const problem = value.trim() ? (validate?.(value.trim()) ?? null) : 'Give it a name.'

  function submit() {
    if (problem) return
    onSubmit(value.trim())
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label={label}
          value={value}
          error={Boolean(problem) && value.trim().length > 0}
          helperText={problem ?? ' '}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          slotProps={{ htmlInput: { maxLength: 64, 'aria-label': label } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={Boolean(problem)} onClick={submit}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

/** Confirming something that cannot be undone. See `NameDialog` on why. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{body}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
