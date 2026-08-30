import { useEffect, useRef } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  CircularProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { EmptyState } from '../../components/ui/EmptyState'
import type { ChatCitation, ChatTurn } from '../../lib/types'

/** Splits an answer on its `[n]` citation markers, keeping them as pieces. */
const MARKER = /(\[\d+\])/g

interface ChatTranscriptProps {
  turns: ChatTurn[]
  busy: boolean
  hasSources: boolean
}

export function ChatTranscript({ turns, busy, hasSources }: ChatTranscriptProps) {
  const end = useRef<HTMLDivElement>(null)

  // Follow the conversation down as it grows, and while an answer is pending
  // so the thinking indicator stays in view.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  if (turns.length === 0) {
    return (
      <Box className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<ChatBubbleOutlineIcon fontSize="small" />}
          title={hasSources ? 'Ask something' : 'Pick a source first'}
          description={
            hasSources
              ? 'Answers are written only from the passages retrieved out of the sources you selected, and every claim is cited back to the document it came from.'
              : 'Select one or more embedded sources on the right. Everything asked here is answered from those documents alone.'
          }
        />
      </Box>
    )
  }

  return (
    <Box className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {turns.map((turn) => (
        <Box
          key={turn.id}
          className={
            turn.role === 'user'
              ? 'flex justify-end'
              : 'flex max-w-full flex-col items-start gap-2'
          }
        >
          {turn.role === 'user' ? (
            <Paper
              variant="outlined"
              className="max-w-[85%] px-3.5 py-2.5"
              sx={{ bgcolor: 'action.hover', borderRadius: 3, whiteSpace: 'pre-wrap' }}
            >
              <Typography variant="body2">{turn.content}</Typography>
            </Paper>
          ) : (
            <>
              <Paper
                variant="outlined"
                className="w-full px-3.5 py-2.5"
                sx={{
                  borderRadius: 3,
                  borderColor: turn.error ? 'error.main' : 'divider',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Typography variant="body2" color={turn.error ? 'error' : 'text.primary'}>
                  {turn.error ? turn.content : <Answer turn={turn} />}
                </Typography>
              </Paper>
              {turn.citations && turn.citations.length > 0 && (
                <Citations citations={turn.citations} />
              )}
            </>
          )}
        </Box>
      ))}

      {busy && (
        <Box className="flex items-center gap-2 px-1">
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            Retrieving passages and writing an answer…
          </Typography>
        </Box>
      )}

      <div ref={end} />
    </Box>
  )
}

/**
 * An answer with its `[n]` markers picked out.
 *
 * A marker only means something next to the passage it points at, so each is
 * given the document it came from on hover — otherwise the reader has to
 * count down the citation list to find out what `[3]` was.
 */
function Answer({ turn }: { turn: ChatTurn }) {
  const byMarker = new Map((turn.citations ?? []).map((one) => [one.marker, one]))

  return (
    <>
      {turn.content.split(MARKER).map((piece, index) => {
        const marker = /^\[(\d+)\]$/.exec(piece)
        const citation = marker ? byMarker.get(Number(marker[1])) : undefined
        if (!citation) return <span key={index}>{piece}</span>

        return (
          <Tooltip key={index} title={label(citation)}>
            <Box
              component="span"
              sx={{
                bgcolor: 'action.selected',
                color: 'text.secondary',
                borderRadius: 1,
                px: 0.5,
                mx: 0.25,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'default',
              }}
            >
              {citation.marker}
            </Box>
          </Tooltip>
        )
      })}
    </>
  )
}

/**
 * The passages the answer was given — all of them, not only the cited ones.
 *
 * Retrieval is the part of a RAG pipeline that quietly goes wrong, and it is
 * only visible here: an answer that says the documents do not cover something
 * reads very differently once you can see that the right passage never came
 * back.
 */
function Citations({ citations }: { citations: ChatCitation[] }) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        width: '100%',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        '&::before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.5, minHeight: 40 }}>
        <Typography variant="caption" color="text.secondary">
          {citations.length} {citations.length === 1 ? 'passage' : 'passages'} retrieved
        </Typography>
      </AccordionSummary>
      <AccordionDetails
        sx={{ p: 0, borderTop: 1, borderColor: 'divider', maxHeight: 320, overflowY: 'auto' }}
      >
        {citations.map((citation) => (
          <Box
            key={citation.chunkId}
            className="px-3 py-2"
            sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
          >
            <Typography variant="caption" color="text.secondary" component="p">
              <Box component="span" sx={{ fontWeight: 700 }}>
                [{citation.marker}]
              </Box>{' '}
              {label(citation)} · similarity {citation.score.toFixed(3)}
            </Typography>
            <Typography variant="caption" component="p" className="mt-0.5">
              {citation.text}
            </Typography>
          </Box>
        ))}
      </AccordionDetails>
    </Accordion>
  )
}

/** `report.pdf (pp. 3–4)` — the pages are absent for a text file. */
function label(citation: ChatCitation): string {
  if (citation.pages.length === 0) return citation.documentName
  const first = citation.pages[0]
  const last = citation.pages[citation.pages.length - 1]
  return `${citation.documentName} (${first === last ? `p. ${first}` : `pp. ${first}–${last}`})`
}
