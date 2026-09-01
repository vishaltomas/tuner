import { useState } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import type { WidgetKind } from '../../lib/types'
import { ICONS } from './icons'
import { DRAG_TYPE, WIDGET_ORDER, WIDGETS } from './widgets'

interface WidgetRailProps {
  /** How many of each kind are on the canvas, for the per-kind limit. */
  counts: Record<WidgetKind, number>
  onAdd: (kind: WidgetKind) => void
}

/**
 * The widget catalogue, as a list of icons.
 *
 * Icon-led rather than card-led: the rail is narrow, the catalogue will grow,
 * and once someone knows the icons a list of them is far quicker to scan than
 * a column of prose. The label and description stay — as a caption and a
 * tooltip — so the icons are learnable rather than something to memorise.
 */
export function WidgetRail({ counts, onAdd }: WidgetRailProps) {
  // Tooltips are driven by hand so a drag can close them. A drag fires no
  // mouseleave, so a hover-managed tooltip would stay open and hang over the
  // canvas for the whole gesture — on top of the drop target.
  const [hovered, setHovered] = useState<WidgetKind | null>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <Box className="flex flex-col gap-1 p-2">
      {WIDGET_ORDER.map((kind) => {
        const spec = WIDGETS[kind]
        const full = spec.max !== undefined && counts[kind] >= spec.max

        return (
          <Tooltip
            key={kind}
            open={hovered === kind && !dragging}
            disableInteractive
            placement="left"
            title={
              <>
                <strong>{spec.label}</strong>
                <br />
                {spec.blurb}
                {full && (
                  <>
                    <br />
                    Already on the canvas.
                  </>
                )}
              </>
            }
          >
            <Box
              // Drag is the primary gesture, but it is unreachable from a
              // keyboard and awkward on a trackpad, so click adds too.
              role="button"
              tabIndex={full ? -1 : 0}
              aria-disabled={full}
              aria-label={spec.label}
              draggable={!full}
              onMouseEnter={() => setHovered(kind)}
              onMouseLeave={() => setHovered(null)}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, kind)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(true)
                setHovered(null)
              }}
              onDragEnd={() => setDragging(false)}
              onClick={() => !full && onAdd(kind)}
              onKeyDown={(event) => {
                if (!full && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onAdd(kind)
                }
              }}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.25,
                px: 0.5,
                py: 1,
                borderRadius: 1.5,
                border: 1,
                borderColor: 'transparent',
                cursor: full ? 'not-allowed' : 'grab',
                opacity: full ? 0.4 : 1,
                color: `${spec.tone}.main`,
                '&:hover': full
                  ? {}
                  : { borderColor: `${spec.tone}.main`, bgcolor: 'action.hover' },
                '&:focus-visible': { outline: 2, outlineColor: `${spec.tone}.main` },
              }}
            >
              {ICONS[kind]}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: 10, lineHeight: 1.2, textAlign: 'center' }}
              >
                {spec.label}
              </Typography>
            </Box>
          </Tooltip>
        )
      })}
    </Box>
  )
}
