import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { FlowFile, FlowGraph, Workflow } from '../lib/types'

export const MAIN = 'main.flow'
export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] }

/**
 * The workflows on the server, and the flows inside the one being edited.
 *
 * Unlike sources there is no browser-local mirror: a workflow is a directory
 * the backend owns and runs, and a copy kept here would be a second answer to
 * "what does this workflow contain" that nothing reconciles.
 */
export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const remote = await api.fetchWorkflows()
    if (remote) setWorkflows(remote)
    setLoading(false)
    return remote
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (name: string) => {
      const made = await api.createWorkflow(name)
      if (!made) throw new Error('create failed')
      await refresh()
      return made
    },
    [refresh],
  )

  const rename = useCallback(
    async (name: string, next: string) => {
      const renamed = await api.renameWorkflow(name, next)
      if (!renamed) throw new Error('rename failed')
      await refresh()
      return renamed
    },
    [refresh],
  )

  const remove = useCallback(
    async (name: string) => {
      const gone = await api.deleteWorkflow(name)
      if (!gone) throw new Error('delete failed')
      await refresh()
    },
    [refresh],
  )

  return { workflows, loading, refresh, create, rename, remove }
}

/** The `.flow` files inside one workflow. */
export function useFlows(workflow: string | null) {
  const [files, setFiles] = useState<FlowFile[]>([])

  const refresh = useCallback(async () => {
    if (!workflow) {
      setFiles([])
      return null
    }
    const remote = await api.fetchFlows(workflow)
    if (remote) setFiles(remote)
    return remote
  }, [workflow])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (name: string, graph: FlowGraph) => {
      if (!workflow) throw new Error('no workflow open')
      const written = await api.saveFlow(workflow, name, graph)
      if (!written) throw new Error('save failed')
      await refresh()
      return written
    },
    [refresh, workflow],
  )

  const rename = useCallback(
    async (name: string, next: string) => {
      if (!workflow) throw new Error('no workflow open')
      const renamed = await api.renameFlow(workflow, name, next)
      if (!renamed) throw new Error('rename failed')
      await refresh()
      return renamed
    },
    [refresh, workflow],
  )

  const remove = useCallback(
    async (name: string) => {
      if (!workflow) return
      await api.deleteFlow(workflow, name)
      await refresh()
    },
    [refresh, workflow],
  )

  return { files, refresh, save, rename, remove }
}
