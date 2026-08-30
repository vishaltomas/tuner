import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { readChatSettings, writeChatSettings } from '../lib/storage'
import type { ChatDefaults, ChatTurn, Source } from '../lib/types'
import { uid } from '../lib/utils'

/**
 * Shown until `/chat/defaults` answers, and if it never does.
 *
 * The backend owns the real text — the same string `/chat` falls back to when
 * the box is cleared — so this is only what fills the field in the moment
 * before it arrives, or while the backend is down.
 */
const FALLBACK_DEFAULTS: ChatDefaults = {
  system:
    'You are a careful research assistant. Answer in plain, direct prose, and prefer the ' +
    'wording of the documents over your own paraphrase when the distinction matters.',
  model: 'the configured chat model',
  contextChunks: 6,
}

/**
 * The chat pane's state: what is being asked, of which sources, under what
 * system message.
 *
 * The transcript lives here rather than on the server — `/chat` is stateless
 * and is handed the history on every question — so clearing it is a local
 * act, and reloading the page starts a new conversation. The settings around
 * it do survive a reload; see `lib/storage`.
 */
export function useChat(sources: Source[]) {
  const stored = useRef(readChatSettings()).current

  const [defaults, setDefaults] = useState<ChatDefaults>(FALLBACK_DEFAULTS)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [system, setSystem] = useState(stored.system ?? '')
  const [sourceIds, setSourceIds] = useState<string[]>(stored.sourceIds ?? [])
  const [topK, setTopK] = useState(stored.topK ?? FALLBACK_DEFAULTS.contextChunks)
  const [busy, setBusy] = useState(false)
  // The reason the last question failed, shown above the composer. Cleared
  // when the next one is asked.
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await api.fetchChatDefaults()
      if (cancelled || !remote) return
      setDefaults(remote)
      // Only seed the box the user has not written in — replacing their text
      // with the server's default would throw away what they came back for.
      setSystem((previous) => (previous.trim() ? previous : remote.system))
      if (stored.topK === undefined) setTopK(remote.contextChunks)
    })()
    return () => {
      cancelled = true
    }
  }, [stored.topK])

  useEffect(() => {
    writeChatSettings({ system, sourceIds, topK })
  }, [system, sourceIds, topK])

  // A source can be deleted from the other section while it is selected here.
  useEffect(() => {
    setSourceIds((previous) =>
      previous.filter((id) => sources.some((source) => source.id === id)),
    )
  }, [sources])

  const toggleSource = useCallback((sourceId: string) => {
    setSourceIds((previous) =>
      previous.includes(sourceId)
        ? previous.filter((id) => id !== sourceId)
        : [...previous, sourceId],
    )
  }, [])

  const send = useCallback(
    async (message: string) => {
      const question = message.trim()
      if (!question || busy || sourceIds.length === 0) return

      const asked: ChatTurn = {
        id: uid('turn'),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      }

      // The history the backend is given is what was on screen before this
      // question — `turns` here, not the state after the append, which has
      // not landed yet and would duplicate the question in the prompt.
      const history = turns
      setTurns((previous) => [...previous, asked])
      setBusy(true)
      setError(null)

      const result = await api.sendChat({ message: question, sourceIds, system, history, topK })

      setTurns((previous) => [
        ...previous,
        'reply' in result
          ? {
              id: uid('turn'),
              role: 'assistant',
              content: result.reply.answer,
              citations: result.reply.citations,
              createdAt: new Date().toISOString(),
            }
          : {
              id: uid('turn'),
              role: 'assistant',
              content: result.error,
              error: true,
              createdAt: new Date().toISOString(),
            },
      ])
      if ('error' in result) setError(result.error)
      setBusy(false)
    },
    [busy, sourceIds, system, topK, turns],
  )

  const clear = useCallback(() => {
    setTurns([])
    setError(null)
  }, [])

  const resetSystem = useCallback(() => setSystem(defaults.system), [defaults.system])

  return {
    defaults,
    turns,
    system,
    setSystem,
    resetSystem,
    sourceIds,
    toggleSource,
    topK,
    setTopK,
    busy,
    error,
    send,
    clear,
  }
}
