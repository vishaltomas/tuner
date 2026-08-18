import type { DocumentKind } from './types'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatCount(value: number | undefined): string {
  if (value === undefined) return '—'
  return value.toLocaleString()
}

const ACCEPTED: Record<string, DocumentKind> = {
  pdf: 'pdf',
  txt: 'txt',
}

/** Resolve a file to a supported kind, or `null` if we do not accept it. */
export function kindOf(file: File): DocumentKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ACCEPTED[extension] ?? null
}

/** Rough vector count so local previews show something plausible. */
export function estimateChunks(size: number): number {
  return Math.max(1, Math.round(size / 2000))
}

export function totalChunks(documents: { chunks?: number }[]): number {
  return documents.reduce((sum, doc) => sum + (doc.chunks ?? 0), 0)
}

export function totalSize(documents: { size: number }[]): number {
  return documents.reduce((sum, doc) => sum + doc.size, 0)
}
