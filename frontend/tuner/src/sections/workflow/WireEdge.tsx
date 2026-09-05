import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { Box } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

/** What the canvas passes each wire. */
export interface WireEdgeData extends Record<string, unknown> {
  /** True while the pointer is over this wire, or it is selected. */
  active?: boolean
  onDelete?: (id: string) => void
}

/**
 * One wire, with a way to remove it.
 *
 * React Flow will delete a selected edge on Backspace and nothing else, which
 * is both undiscoverable and the wrong key for most people. The button here is
 * the answer to "how do I unwire this" — it appears on hover, where the
 * question is being asked.
 */
export function WireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps & { data?: WireEdgeData }) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const active = Boolean(selected || data?.active)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: active ? 2 : 1,
          stroke: active ? 'var(--mui-palette-primary-main)' : undefined,
        }}
        // The stroke is a couple of pixels; this is the width of the invisible
        // band that actually answers the pointer, so a wire can be hovered
        // without hunting for it.
        interactionWidth={24}
      />

      {active && (
        // Outside the SVG, so the button is a real button — focusable, and
        // styled by the theme rather than by hand in SVG.
        <EdgeLabelRenderer>
          <Box
            role="button"
            tabIndex={0}
            aria-label="Remove this wire"
            onClick={(event) => {
              event.stopPropagation()
              data?.onDelete?.(id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                data?.onDelete?.(id)
              }
            }}
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // The label layer ignores the pointer so wires stay draggable
              // through it; this one control opts back in.
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              cursor: 'pointer',
              bgcolor: 'background.paper',
              color: 'text.secondary',
              border: 1,
              borderColor: 'divider',
              '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
              '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
            }}
          >
            <CloseIcon sx={{ fontSize: 12 }} />
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
