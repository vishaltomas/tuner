import type { Source } from './types'

const KEY = 'tuner.sources.v1'

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
