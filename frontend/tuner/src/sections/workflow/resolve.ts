import type { FlowGraph } from '../../lib/types'
import { WIDGETS } from './widgets'

/**
 * What a flow is missing before it can answer a question.
 *
 * The backend decides this for real — it compiles the flow and runs it — but
 * saying so on the canvas means the user finds out while they are drawing
 * rather than when they ask a question. The wording is kept in step with
 * `rag/workflow.py`'s `problems()`, which is the one that actually refuses.
 *
 * Only what reaches the `answer` widget counts. A widget left unwired is one
 * the user dropped and has not connected yet; treating it as active would mean
 * a half-built flow behaved as though it were finished.
 */
export function resolve(graph: FlowGraph): {
  problems: string[]
  reachable: Set<string>
  /** Flows named by reachable Agent widgets, for the canvas to warn about. */
  calls: string[]
} {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const answer = graph.nodes.find((node) => node.kind === 'answer')

  const reachable = new Set<string>()
  if (answer) {
    // Breadth-first over incoming edges. The `seen` guard is what keeps a
    // cycle — which the canvas does not prevent — from looping forever.
    const queue = [answer.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (reachable.has(id)) continue
      reachable.add(id)
      for (const edge of graph.edges) {
        if (edge.target === id && !reachable.has(edge.source)) queue.push(edge.source)
      }
    }
  }

  const live = [...reachable].map((id) => byId.get(id)).filter((node) => node !== undefined)
  const calls = live
    .filter((node) => node.kind === 'agent')
    .map((node) => node.config.flow)
    .filter((name): name is string => Boolean(name))

  const problems: string[] = []
  if (!answer) {
    problems.push('Add an Answer widget — it is where the conversation happens.')
    return { problems, reachable, calls }
  }

  for (const kind of ['system', 'retrieval', 'answer'] as const) {
    const found = live.filter((node) => node.kind === kind).length
    if (found > 1) {
      problems.push(`This flow has ${found} ${WIDGETS[kind].label} widgets; it may have one.`)
    }
  }

  const feeds = live.filter((node) => node.kind === 'source' || node.kind === 'agent')
  if (feeds.length === 0) {
    problems.push('Wire a Source or an Agent widget through to the Answer widget.')
  }

  for (const node of feeds) {
    if (node.kind === 'agent' && !node.config.flow) {
      problems.push('An Agent widget names no flow to run.')
      break
    }
  }

  const unsetFiles = feeds.filter(
    (node) =>
      node.kind === 'source' &&
      (node.config.sourceType ?? 'files') === 'files' &&
      !node.config.sourceId,
  )
  if (unsetFiles.length > 0) {
    problems.push(
      `${unsetFiles.length} connected Source ${
        unsetFiles.length === 1 ? 'widget has' : 'widgets have'
      } no source picked.`,
    )
  }

  const emptyText = feeds.filter(
    (node) =>
      node.kind === 'source' &&
      node.config.sourceType === 'txt' &&
      !(node.config.text ?? '').trim(),
  )
  if (emptyText.length > 0) {
    problems.push('A text Source widget is empty.')
  }

  return { problems, reachable, calls }
}

/**
 * Why a wire from one widget to another cannot be drawn, or `null` if it can.
 *
 * The string is shown to the user, so each reason says what is wrong in terms
 * of the widgets rather than the graph — "System message does not take an
 * input" is actionable in a way that "invalid target handle" is not.
 *
 * This is the single definition of a legal wire: React Flow refuses the
 * connection with it, and the canvas explains the refusal with it, so the two
 * can never disagree about what is allowed.
 */
export function connectionIssue(
  graph: FlowGraph,
  fromId: string,
  toId: string,
): string | null {
  if (fromId === toId) return 'A widget cannot connect to itself.'

  const from = graph.nodes.find((node) => node.id === fromId)
  const to = graph.nodes.find((node) => node.id === toId)
  if (!from || !to) return 'That widget is no longer on the canvas.'

  if (!WIDGETS[from.kind].outputs) {
    return `${WIDGETS[from.kind].label} has no output to wire from.`
  }
  if (!WIDGETS[to.kind].inputs) {
    return `${WIDGETS[to.kind].label} does not take an input — wire it onwards instead.`
  }
  if (graph.edges.some((edge) => edge.source === fromId && edge.target === toId)) {
    return `Already wired to ${WIDGETS[to.kind].label}.`
  }
  // Following the target's own outputs back round to the source means the wire
  // would close a loop. `resolve` survives one, but a flow that feeds its own
  // input describes nothing a question can be answered from.
  if (reaches(graph, toId, fromId)) {
    return 'That would make a loop.'
  }
  return null
}

/** Whether `toId` is downstream of `fromId`, following edges forwards. */
function reaches(graph: FlowGraph, fromId: string, toId: string): boolean {
  const seen = new Set<string>()
  const queue = [fromId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (id === toId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of graph.edges) {
      if (edge.source === id) queue.push(edge.target)
    }
  }
  return false
}
