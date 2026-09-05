import type { ReactNode } from 'react'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import LoginOutlinedIcon from '@mui/icons-material/LoginOutlined'
import ScatterPlotOutlinedIcon from '@mui/icons-material/ScatterPlotOutlined'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined'
import SortOutlinedIcon from '@mui/icons-material/SortOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import type { WidgetKind } from '../../lib/types'

/**
 * The face of each widget kind.
 *
 * Split from the registry in `widgets.ts` so that module stays free of JSX and
 * its wiring rules can be tested without a renderer.
 */
export const ICONS: Record<WidgetKind, ReactNode> = {
  input: <LoginOutlinedIcon fontSize="small" />,
  source: <LayersOutlinedIcon fontSize="small" />,
  embed: <ScatterPlotOutlinedIcon fontSize="small" />,
  reranker: <SortOutlinedIcon fontSize="small" />,
  router: <AltRouteOutlinedIcon fontSize="small" />,
  agent: <SmartToyOutlinedIcon fontSize="small" />,
  system: <TuneOutlinedIcon fontSize="small" />,
  output: <ChatBubbleOutlineIcon fontSize="small" />,
}
