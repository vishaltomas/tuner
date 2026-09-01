import type { ReactNode } from 'react'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import ManageSearchOutlinedIcon from '@mui/icons-material/ManageSearchOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import type { WidgetKind } from '../../lib/types'

/**
 * The face of each widget kind.
 *
 * Split from the registry in `widgets.ts` so that module stays free of JSX and
 * its wiring rules can be tested without a renderer.
 */
export const ICONS: Record<WidgetKind, ReactNode> = {
  source: <LayersOutlinedIcon fontSize="small" />,
  agent: <SmartToyOutlinedIcon fontSize="small" />,
  system: <TuneOutlinedIcon fontSize="small" />,
  retrieval: <ManageSearchOutlinedIcon fontSize="small" />,
  answer: <ChatBubbleOutlineIcon fontSize="small" />,
}
