import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api'
import type { DownloadJob } from '../lib/types'

/** Matches the backend's own progress poller, so every tick has new numbers. */
const POLL_MS = 1000

const isFinished = (job: DownloadJob) => job.status === 'succeeded' || job.status === 'failed'

/**
 * Start a model download and follow it to completion.
 *
 * The backend hands back a job row rather than the finished model, so progress
 * is read by polling `/jobs/{id}` until it settles. Polling stops the moment
 * the job finishes — and never starts if the route is unavailable, which is
 * how this behaves against a backend that has not caught up yet.
 */
export function useModelDownload(modelId: string) {
  const [job, setJob] = useState<DownloadJob | null>(null)
  const [starting, setStarting] = useState(false)
  const [supported, setSupported] = useState(true)
  const [localSize, setLocalSize] = useState<number | null>(null)
  const seenModel = useRef(modelId)

  // A job belongs to one model; switching the picker abandons it.
  if (seenModel.current !== modelId) {
    seenModel.current = modelId
    if (job) setJob(null)
  }

  const refreshLocal = useCallback(async () => {
    const local = await api.fetchLocalModels()
    if (local === null) return
    const match = local.find((model) => model.id === modelId)
    setLocalSize(match?.sizeBytes ?? null)
  }, [modelId])

  useEffect(() => {
    void refreshLocal()
  }, [refreshLocal])

  const start = useCallback(async () => {
    if (!modelId) return
    setStarting(true)
    const started = await api.startModelDownload(modelId)
    setStarting(false)
    if (started === null) {
      setSupported(false)
      return
    }
    setJob(started)
  }, [modelId])

  const jobId = job?.id
  const finished = job === null || isFinished(job)

  useEffect(() => {
    if (!jobId || finished) return

    let cancelled = false
    const timer = window.setInterval(() => {
      void (async () => {
        const next = await api.fetchDownloadJob(jobId)
        // A null here is a blip, not an outcome — keep the last known state
        // and try again on the next tick.
        if (cancelled || next === null) return
        setJob(next)
        if (next.status === 'succeeded') void refreshLocal()
      })()
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [jobId, finished, refreshLocal])

  return { job, start, starting, supported, localSize }
}
