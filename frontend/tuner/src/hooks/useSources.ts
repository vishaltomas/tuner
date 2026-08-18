import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import { readSources, writeSources } from '../lib/storage'
import type { Source, SourceDocument } from '../lib/types'
import { estimateChunks, kindOf, uid } from '../lib/utils'

interface EmbedInput {
  /** Existing source to append to, or `null` to create a new one. */
  sourceId: string | null
  name: string
  description?: string
  model: string
  files: File[]
}

function newDocuments(files: File[]): SourceDocument[] {
  const addedAt = new Date().toISOString()
  return files.map((file) => ({
    id: uid('doc'),
    name: file.name,
    size: file.size,
    kind: kindOf(file) ?? 'txt',
    status: 'queued',
    addedAt,
  }))
}

export function useSources() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const loaded = useRef(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await api.fetchSources()
      if (cancelled) return
      setSources(remote ?? readSources())
      setLoading(false)
      loaded.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Mirror every change locally so a reload does not lose the user's setup.
  useEffect(() => {
    if (loaded.current) writeSources(sources)
  }, [sources])

  const clearTimers = useRef(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  })
  useEffect(() => clearTimers.current, [])

  /**
   * Walk locally-created documents through their embedding states.
   *
   * Only used when the backend did not answer — it stands in for the progress
   * the real `/embed` route will report.
   */
  const simulateEmbedding = useCallback((sourceId: string, documentIds: string[]) => {
    documentIds.forEach((documentId, index) => {
      const advance = (status: SourceDocument['status'], delay: number) => {
        const timer = window.setTimeout(() => {
          setSources((prev) =>
            prev.map((source) =>
              source.id !== sourceId
                ? source
                : {
                    ...source,
                    updatedAt: new Date().toISOString(),
                    documents: source.documents.map((doc) =>
                      doc.id !== documentId
                        ? doc
                        : {
                            ...doc,
                            status,
                            chunks: status === 'ready' ? estimateChunks(doc.size) : doc.chunks,
                          },
                    ),
                  },
            ),
          )
        }, delay)
        timers.current.push(timer)
      }

      advance('embedding', 300 + index * 250)
      advance('ready', 1400 + index * 600)
    })
  }, [])

  const embed = useCallback(
    async (input: EmbedInput): Promise<Source> => {
      const remote = await api.embedDocuments(input)
      if (remote) {
        setSources((prev) => {
          const exists = prev.some((source) => source.id === remote.id)
          return exists
            ? prev.map((source) => (source.id === remote.id ? remote : source))
            : [remote, ...prev]
        })
        return remote
      }

      // Local fallback: build the source ourselves and fake the progress.
      const documents = newDocuments(input.files)
      const now = new Date().toISOString()
      let result: Source

      if (input.sourceId) {
        const existing = sources.find((source) => source.id === input.sourceId)
        result = {
          ...(existing as Source),
          updatedAt: now,
          documents: [...(existing?.documents ?? []), ...documents],
        }
        setSources((prev) =>
          prev.map((source) => (source.id === input.sourceId ? result : source)),
        )
      } else {
        result = {
          id: uid('src'),
          name: input.name,
          description: input.description,
          model: input.model,
          createdAt: now,
          updatedAt: now,
          documents,
        }
        setSources((prev) => [result, ...prev])
      }

      simulateEmbedding(
        result.id,
        documents.map((doc) => doc.id),
      )
      return result
    },
    [simulateEmbedding, sources],
  )

  const merge = useCallback(
    async (sourceIds: string[], name: string, keepOriginals: boolean): Promise<Source> => {
      const remote = await api.mergeSources(sourceIds, name, keepOriginals)
      if (remote) {
        setSources((prev) => [
          remote,
          ...prev.filter(
            (source) => source.id !== remote.id && (keepOriginals || !sourceIds.includes(source.id)),
          ),
        ])
        return remote
      }

      const picked = sources.filter((source) => sourceIds.includes(source.id))
      const now = new Date().toISOString()
      const merged: Source = {
        id: uid('src'),
        name,
        model: picked[0]?.model ?? '',
        createdAt: now,
        updatedAt: now,
        mergedFrom: picked.map((source) => source.name),
        documents: picked.flatMap((source) => source.documents),
      }
      setSources((prev) => [
        merged,
        ...prev.filter((source) => keepOriginals || !sourceIds.includes(source.id)),
      ])
      return merged
    },
    [sources],
  )

  const removeSource = useCallback(async (sourceId: string) => {
    await api.deleteSource(sourceId)
    setSources((prev) => prev.filter((source) => source.id !== sourceId))
  }, [])

  const removeDocument = useCallback(async (sourceId: string, documentId: string) => {
    await api.deleteDocument(sourceId, documentId)
    setSources((prev) =>
      prev.map((source) =>
        source.id !== sourceId
          ? source
          : {
              ...source,
              updatedAt: new Date().toISOString(),
              documents: source.documents.filter((doc) => doc.id !== documentId),
            },
      ),
    )
  }, [])

  return { sources, loading, embed, merge, removeSource, removeDocument }
}
