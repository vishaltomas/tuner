import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import SearchIcon from '@mui/icons-material/Search'
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined'
import { EmptyState } from '../../components/ui/EmptyState'
import type { Source } from '../../lib/types'
import { SourceCard } from './SourceCard'

interface SourceListProps {
  sources: Source[]
  loading: boolean
  selectedIds: string[]
  onToggleSelected: (sourceId: string) => void
  onClearSelection: () => void
  onMerge: () => void
  onDeleteSource: (sourceId: string) => void
  onDeleteDocument: (sourceId: string, documentId: string) => void
}

export function SourceList({
  sources,
  loading,
  selectedIds,
  onToggleSelected,
  onClearSelection,
  onMerge,
  onDeleteSource,
  onDeleteDocument,
}: SourceListProps) {
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sources
    return sources.filter(
      (source) =>
        source.name.toLowerCase().includes(query) ||
        source.model.toLowerCase().includes(query) ||
        source.documents.some((doc) => doc.name.toLowerCase().includes(query)),
    )
  }, [search, sources])

  return (
    <Card>
      <CardHeader
        title="Sources"
        subheader="Every upload session and the documents stored under it."
        action={
          <Box className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  {selectedIds.length} selected
                </Typography>
                <Button size="small" onClick={onClearSelection}>
                  Clear
                </Button>
              </>
            )}
            <Tooltip
              title={
                selectedIds.length < 2
                  ? 'Select two or more sources to merge them'
                  : 'Merge the selected sources'
              }
            >
              <span>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<CallMergeIcon />}
                  disabled={selectedIds.length < 2}
                  onClick={onMerge}
                >
                  Merge selected
                </Button>
              </span>
            </Tooltip>
          </Box>
        }
      />

      <CardContent className="flex flex-col gap-4">
        {sources.length > 0 && (
          <TextField
            value={search}
            placeholder="Search sources, documents, or models"
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}

        {loading ? (
          <Box className="flex items-center justify-center gap-2 py-12">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading sources…
            </Typography>
          </Box>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={<StorageOutlinedIcon fontSize="small" />}
            title="No sources yet"
            description="Upload a set of PDFs or text files above to create your first source. Each upload session becomes a named group of documents in the vector store."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchIcon fontSize="small" />}
            title="Nothing matched"
            description={`No source, document, or model matches “${search}”.`}
          />
        ) : (
          <Box className="flex flex-col gap-2.5">
            {visible.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                selected={selectedIds.includes(source.id)}
                onToggleSelected={() => onToggleSelected(source.id)}
                onDelete={() => onDeleteSource(source.id)}
                onDeleteDocument={(documentId) => onDeleteDocument(source.id, documentId)}
              />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
