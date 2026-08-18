import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { DocumentStatus, Source } from '../../lib/types'
import { formatBytes, formatCount, formatDate, totalChunks, totalSize } from '../../lib/utils'

type ChipColor = 'default' | 'primary' | 'success' | 'error'

const STATUS: Record<DocumentStatus, { label: string; color: ChipColor }> = {
  queued: { label: 'Queued', color: 'default' },
  embedding: { label: 'Embedding', color: 'primary' },
  ready: { label: 'Ready', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
}

interface SourceCardProps {
  source: Source
  selected: boolean
  onToggleSelected: () => void
  onDelete: () => void
  onDeleteDocument: (documentId: string) => void
}

export function SourceCard({
  source,
  selected,
  onToggleSelected,
  onDelete,
  onDeleteDocument,
}: SourceCardProps) {
  const working = source.documents.some(
    (doc) => doc.status === 'embedding' || doc.status === 'queued',
  )

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: 2,
        '&::before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.5 }}>
        <Box className="flex min-w-0 flex-1 items-start gap-2">
          <Checkbox
            size="small"
            checked={selected}
            slotProps={{ input: { 'aria-label': `Select ${source.name}` } }}
            // The summary toggles the panel; the checkbox must not.
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.stopPropagation()}
            onChange={onToggleSelected}
            sx={{ mt: -0.25 }}
          />

          <Box className="min-w-0 flex-1">
            <Box className="flex flex-wrap items-center gap-1.5">
              <Typography variant="subtitle2" noWrap>
                {source.name}
              </Typography>
              {source.mergedFrom && (
                <Chip icon={<CallMergeIcon />} label="merged" color="primary" variant="outlined" />
              )}
              {working && (
                <Chip
                  icon={<CircularProgress size={12} sx={{ ml: 0.75 }} />}
                  label="embedding"
                  color="primary"
                  variant="outlined"
                />
              )}
            </Box>

            {source.description && (
              <Typography variant="caption" color="text.secondary" component="p" noWrap>
                {source.description}
              </Typography>
            )}

            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                {source.model}
              </Box>
              <span>·</span>
              <span>
                {source.documents.length} {source.documents.length === 1 ? 'document' : 'documents'}
              </span>
              <span>·</span>
              <span>{formatCount(totalChunks(source.documents))} vectors</span>
              <span>·</span>
              <span>{formatBytes(totalSize(source.documents))}</span>
              <span>·</span>
              <span>updated {formatDate(source.updatedAt)}</span>
            </Typography>

            {source.mergedFrom && source.mergedFrom.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="p">
                Merged from {source.mergedFrom.join(', ')}
              </Typography>
            )}
          </Box>

          <Tooltip title={`Delete ${source.name}`}>
            <IconButton
              size="small"
              aria-label={`Delete ${source.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              <DeleteOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0, borderTop: 1, borderColor: 'divider' }}>
        {source.documents.length === 0 ? (
          <Typography variant="body2" color="text.secondary" className="px-4 py-6 text-center">
            This source has no documents yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell align="right">Vectors</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Added</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {source.documents.map((doc) => (
                <TableRow key={doc.id} hover>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Box className="flex items-center gap-1.5">
                      <DescriptionOutlinedIcon fontSize="small" color="disabled" />
                      <Typography variant="body2" noWrap>
                        {doc.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textTransform: 'uppercase' }}>{doc.kind}</TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatBytes(doc.size)}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatCount(doc.chunks)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={STATUS[doc.status].label}
                      color={STATUS[doc.status].color}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(doc.addedAt)}</TableCell>
                  <TableCell padding="checkbox">
                    <IconButton
                      size="small"
                      aria-label={`Remove ${doc.name}`}
                      onClick={() => onDeleteDocument(doc.id)}
                    >
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AccordionDetails>
    </Accordion>
  )
}
