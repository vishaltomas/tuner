import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

/** Centred placeholder for lists and panes with nothing to show yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Box className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Box
        sx={{ bgcolor: 'action.hover', color: 'text.secondary' }}
        className="mb-1 flex size-11 items-center justify-center rounded-full"
      >
        {icon}
      </Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2" color="text.secondary" className="max-w-sm">
        {description}
      </Typography>
      {action && <Box className="mt-3">{action}</Box>}
    </Box>
  )
}
