import { useState } from 'react'
import { Box } from '@mui/material'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { NAV_ITEMS, type SectionId } from './components/layout/navigation'
import { useSources } from './hooks/useSources'
import { useWorkflows } from './hooks/useFlows'
import { navigate, useRoute } from './lib/route'
import { totalChunks } from './lib/utils'
import { ComingSoon } from './sections/ComingSoon'
import { ChatSection } from './sections/chat/ChatSection'
import { EmbedDocumentsSection } from './sections/embed/EmbedDocumentsSection'
import { WorkflowPage } from './sections/workflow/WorkflowPage'

function App() {
  const route = useRoute()
  const [section, setSection] = useState<SectionId>('embed')
  const [navOpen, setNavOpen] = useState(false)
  const { sources, loading, embed, merge, reembed, removeSource, removeDocument } = useSources()
  const { workflows } = useWorkflows()

  const vectorCount = sources.reduce((sum, source) => sum + totalChunks(source.documents), 0)
  const activeItem = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0]

  // The workflow editor is its own page, outside the shell — it needs the
  // whole viewport for a canvas with a rail on either side.
  if (route === 'workflow') return <WorkflowPage sources={sources} />

  return (
    <Box className="flex h-full flex-col" sx={{ bgcolor: 'background.default' }}>
      <TopBar onToggleNav={() => setNavOpen((previous) => !previous)} />

      <Box className="flex min-h-0 flex-1">
        <Sidebar
          active={section}
          onSelect={(next) => (next === 'workflow' ? navigate('workflow') : setSection(next))}
          sourceCount={sources.length}
          vectorCount={vectorCount}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />

        <Box component="main" className="min-w-0 flex-1 overflow-y-auto">
          {section === 'embed' && (
            <EmbedDocumentsSection
              sources={sources}
              loading={loading}
              embed={embed}
              merge={merge}
              removeSource={removeSource}
              removeDocument={removeDocument}
            />
          )}
          {section === 'chat' && (
            <ChatSection sources={sources} workflows={workflows} reembed={reembed} />
          )}
          {section !== 'embed' && section !== 'chat' && <ComingSoon item={activeItem} />}
        </Box>
      </Box>
    </Box>
  )
}

export default App
