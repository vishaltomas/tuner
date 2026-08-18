import type { ReactNode } from 'react'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import ViewInArOutlinedIcon from '@mui/icons-material/ViewInArOutlined'

export type SectionId = 'embed' | 'models' | 'playground' | 'settings'

export interface NavItem {
  id: SectionId
  label: string
  description: string
  group: 'Knowledge base' | 'Configure'
  icon: ReactNode
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'embed',
    label: 'Embed Documents',
    description: 'Upload files, embed them, and store the vectors.',
    group: 'Knowledge base',
    icon: <LayersOutlinedIcon fontSize="small" />,
  },
  {
    id: 'playground',
    label: 'Playground',
    description: 'Query your embedded sources and inspect the retrieved chunks.',
    group: 'Knowledge base',
    icon: <AutoAwesomeOutlinedIcon fontSize="small" />,
  },
  {
    id: 'models',
    label: 'Model Catalog',
    description: 'Browse embedding models available on the Hugging Face Hub.',
    group: 'Configure',
    icon: <ViewInArOutlinedIcon fontSize="small" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Vector store connection, API tokens, and defaults.',
    group: 'Configure',
    icon: <SettingsOutlinedIcon fontSize="small" />,
  },
]

export const NAV_GROUPS = ['Knowledge base', 'Configure'] as const
