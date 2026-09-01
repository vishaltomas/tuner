import { useState } from 'react'
import { Handle, Position, useConnection, type NodeProps } from '@xyflow/react'
import { Box, Chip, Tooltip, Typography } from '@mui/material'
import BlockIcon from '@mui/icons-material/Block'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import type { WidgetConfig, WidgetKind } from '../../lib/types'
import { ICONS } from './icons'
import { WIDGETS } from './widgets'

/** What the canvas passes into each node; React Flow requires an index signature. */
export interface WidgetNodeData extends Record<string, unknown> {
  kind: WidgetKind
  config: WidgetConfig
  /** One line of state — the picked source's name, the budget, a truncated prompt. */
  summary: string
  /** False when nothing connects this node through to the Answer widget. */
  live: boolean
  /** Set when the node is connected but not yet usable. */
  warning?: string
  /**
   * Why a wire being dragged right now could not land here, if it could not.
   * Recomputed by the canvas for the duration of a connection drag.
   */
  connectIssue?: string
}

/**
 * One widget on the canvas.
 *
 * Deliberately thin: it renders what the registry says about its kind and the
 * summary the canvas computed. Editing happens in the inspector, not here — a
 * node small enough to wire comfortably is too small to hold a prompt box.
 */
export function WidgetNode({ data, selected }: NodeProps & { data: WidgetNodeData }) {
  const spec = WIDGETS[data.kind]
  const [hovered, setHovered] = useState(false)

  // Only the fact that a drag is happening is taken from the store, so a
  // pointer move during a connection does not re-render every node for a
  // value none of them use.
  const connecting = useConnection((connection) => connection.inProgress)
  const refusing = connecting && Boolean(data.connectIssue)

  return (
    <Tooltip
      // Shown only while a wire is actually being dragged over this widget:
      // the same message outside a connection would be advice about a gesture
      // the user is not making.
      open={refusing && hovered}
      disableInteractive
      placement="right"
      title={
        <Box className="flex items-center gap-1">
          <BlockIcon sx={{ fontSize: 14 }} />
          {data.connectIssue}
        </Box>
      }
    >
      <Box
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        sx={{
          width: 210,
          borderRadius: 2,
          border: 2,
          borderColor: refusing
            ? 'error.main'
            : selected
              ? `${spec.tone}.main`
              : 'divider',
          bgcolor: 'background.paper',
          // A node that reaches the Answer widget is part of the workflow; one
          // that does not is faded, so an unwired widget reads as inert rather
          // than as something that will quietly take effect.
          opacity: refusing ? 0.55 : data.live ? 1 : 0.45,
          boxShadow: selected ? 3 : 0,
          // The cursor says the wire cannot land here before the tooltip has
          // had time to appear.
          cursor: refusing ? 'not-allowed' : undefined,
          transition: 'border-color 120ms, opacity 120ms',
        }}
      >
        {spec.inputs && (
          <Handle type="target" position={Position.Top} style={{ width: 9, height: 9 }} />
        )}

        <Box
          className="flex items-center gap-1.5 px-2.5 py-1.5"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            color: refusing ? 'error.main' : `${spec.tone}.main`,
          }}
        >
          {refusing ? <BlockIcon fontSize="small" /> : ICONS[data.kind]}
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {spec.label}
          </Typography>
          {data.warning && !refusing && (
            <WarningAmberOutlinedIcon fontSize="small" color="warning" sx={{ ml: 'auto' }} />
          )}
        </Box>

        <Box className="px-2.5 py-2">
          <Typography
            variant="caption"
            color={refusing ? 'error' : 'text.secondary'}
            className="line-clamp-2 block"
          >
            {refusing ? data.connectIssue : data.summary}
          </Typography>
          {!data.live && !refusing && (
            <Chip label="not connected" variant="outlined" className="mt-1.5" />
          )}
        </Box>

        {spec.outputs && (
          <Handle type="source" position={Position.Bottom} style={{ width: 9, height: 9 }} />
        )}
      </Box>
    </Tooltip>
  )
}
