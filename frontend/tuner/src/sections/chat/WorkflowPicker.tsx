import { Box, Card, CardContent, CardHeader, MenuItem, TextField, Typography } from '@mui/material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import type { Workflow } from '../../lib/types'
import { navigate } from '../../lib/route'
import { Link } from '@mui/material'

interface WorkflowPickerProps {
  workflows: Workflow[]
  /** The one this conversation runs, or null to set the sources by hand. */
  workflow: string | null
  onPick: (workflow: string | null) => void
}

/**
 * Which workflow answers.
 *
 * The whole configuration — sources, system message, retrieval budget — lives
 * in the workflow's own `main.flow`, so this is the only choice the pane has
 * to offer. Picking "None" falls back to setting those by hand, which is what
 * a fresh install has before any workflow has been built.
 */
export function WorkflowPicker({ workflows, workflow, onPick }: WorkflowPickerProps) {
  const picked = workflows.find((one) => one.name === workflow) ?? null

  return (
    <Card className="shrink-0">
      <CardHeader
        title="Workflow"
        subheader={
          picked
            ? 'This conversation runs its main.flow.'
            : 'Pick a workflow, or set the sources by hand below.'
        }
      />
      <CardContent className="flex flex-col gap-2">
        <TextField
          select
          label="Answering with"
          value={workflow ?? ''}
          onChange={(event) => onPick(event.target.value || null)}
          slotProps={{ htmlInput: { 'aria-label': 'Workflow' } }}
        >
          <MenuItem value="">
            <em>None — set sources by hand</em>
          </MenuItem>
          {workflows.map((one) => (
            <MenuItem key={one.name} value={one.name}>
              {one.name}
            </MenuItem>
          ))}
        </TextField>

        {picked && (
          <Box className="flex items-center gap-1">
            <AccountTreeOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">
              {picked.flows} {picked.flows === 1 ? 'flow' : 'flows'} ·{' '}
              <Link
                component="button"
                variant="caption"
                onClick={() => navigate('workflow')}
                sx={{ verticalAlign: 'baseline' }}
              >
                edit it
              </Link>
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
