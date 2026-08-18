import { Box, Card, Typography } from '@mui/material'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import { EmptyState } from '../components/ui/EmptyState'
import type { NavItem } from '../components/layout/navigation'

/** Placeholder pane for nav sections that are not built yet. */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <Box className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 lg:p-7">
      <Box component="header">
        <Typography variant="h1">{item.label}</Typography>
        <Typography variant="body2" color="text.secondary" className="mt-1">
          {item.description}
        </Typography>
      </Box>
      <Card>
        <EmptyState
          icon={<AutoAwesomeOutlinedIcon fontSize="small" />}
          title="Not built yet"
          description="This section is a placeholder. Embed Documents is the section that is live today."
        />
      </Card>
    </Box>
  )
}
