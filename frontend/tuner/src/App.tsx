import { useState } from 'react'
import { Box } from '@mui/material'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { NAV_ITEMS, type SectionId } from './components/layout/navigation'
import { useSources } from './hooks/useSources'
import { totalChunks } from './lib/utils'
import { ComingSoon } from './sections/ComingSoon'
import { EmbedDocumentsSection } from './sections/embed/EmbedDocumentsSection'

function App() {
  const [section, setSection] = useState<SectionId>('embed')
  const [navOpen, setNavOpen] = useState(false)
  const { sources, loading, embed, merge, removeSource, removeDocument } = useSources()

  const vectorCount = sources.reduce((sum, source) => sum + totalChunks(source.documents), 0)
  const activeItem = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0]

  return (
    <Box className="flex h-full flex-col" sx={{ bgcolor: 'background.default' }}>
      <TopBar onToggleNav={() => setNavOpen((previous) => !previous)} />

      <Box className="flex min-h-0 flex-1">
        <Sidebar
          active={section}
          onSelect={setSection}
          sourceCount={sources.length}
          vectorCount={vectorCount}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />

        <Box component="main" className="min-w-0 flex-1 overflow-y-auto">
          {section === 'embed' ? (
            <EmbedDocumentsSection
              sources={sources}
              loading={loading}
              embed={embed}
              merge={merge}
              removeSource={removeSource}
              removeDocument={removeDocument}
            />
          ) : (
            <ComingSoon item={activeItem} />
          )}
        </Box>
      </Box>
    </Box>
  )
}

export default App
