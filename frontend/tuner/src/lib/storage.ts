import type { Source } from './types'

const KEY = 'tuner.sources.v1'
const CHAT_KEY = 'tuner.chat.v1'

/**
 * Browser-local mirror of the source list.
 *
 * The embedding backend is the real store; this keeps the section usable —
 * and keeps whatever the user set up visible across reloads — while the
 * `/embed` routes are still being built out.
 */
export function readSources(): Source[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Source[]) : []
  } catch {
    return []
  }
}

export function writeSources(sources: Source[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sources))
  } catch {
    // Quota or private-mode failures are not worth interrupting the user for.
  }
}

/**
 * The chat pane's settings, as the user last left them.
 *
 * The system message especially is something people tune once and expect to
 * find again — losing it on a reload would make it feel disposable. The
 * transcript itself is not kept: it is a conversation, not a document, and
 * the backend holds no history of it either.
 */
export interface ChatSettings {
  system: string
  sourceIds: string[]
  topK: number
}

export function readChatSettings(): Partial<ChatSettings> {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<ChatSettings>) : {}
  } catch {
    return {}
  }
}

export function writeChatSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(settings))
  } catch {
    // Quota or private-mode failures are not worth interrupting the user for.
  }
}

