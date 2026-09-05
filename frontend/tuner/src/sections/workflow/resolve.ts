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
export function resolve(
  graph: FlowGraph,
  options: { isMain?: boolean } = {},
): {
  problems: string[]
  reachable: Set<string>
  /** Flows named by reachable Agent widgets, for the explorer to mark. */
  calls: string[]
} {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const output = graph.nodes.find((node) => node.kind === 'output')
  const input = graph.nodes.find((node) => node.kind === 'input')

  const reachable = new Set<string>()
  if (output) {
    // Breadth-first over incoming edges. The `seen` guard is what keeps a
    // cycle — which the canvas does not prevent — from looping forever.
    const queue = [output.id]
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
  const add = (text: string) => problems.push(text)

  if (!input) add('Add an Input widget — a run has to start somewhere.')
  if (!output) add('Add an Output widget — a run has to end somewhere.')
  if (!input || !output) return { problems, reachable, calls }
  if (!reachable.has(input.id)) {
    add('Wire the Input widget through to the Output widget.')
  }

  for (const kind of ['input', 'embed', 'reranker', 'system', 'output'] as const) {
    const found = live.filter((node) => node.kind === kind).length
    if (found > 1) {
      add(`This flow has ${found} ${WIDGETS[kind].label} widgets; it may have one.`)
    }
  }

  // `main.flow` is what Chat runs, so its two ends are the conversation.
  if (options.isMain) {
    for (const [node, what] of [
      [input, 'Input'],
      [output, 'Output'],
    ] as const) {
      if ((node.config.mode ?? 'chat') !== 'chat') {
        add(`The ${what} widget in main.flow must be set to Chat.`)
      }
    }
  }

  const retrieving = live.filter(
    (node) => node.kind === 'source' && (node.config.sourceType ?? 'files') === 'files',
  )
  const embed = live.find((node) => node.kind === 'embed')

  if (retrieving.length > 0 && !embed) {
    add('Wire an Embed widget in — it turns the question into a vector to search with.')
  }

  const reranker = live.find((node) => node.kind === 'reranker')
  if (reranker && !reranker.config.model) add('The Reranker widget names no model.')

  for (const router of live.filter((node) => node.kind === 'router')) {
    const routes = router.config.routes ?? []
    if (routes.length < 2) {
      add('A Router needs at least two routes — with one there is nothing to decide.')
      continue
    }
    if (routes.some((route) => !route.when.trim())) {
      add('A route on a Router does not say when to take it.')
    }
    const wired = new Set(
      graph.edges
        .filter((edge) => edge.source === router.id && reachable.has(edge.target))
        .map((edge) => edge.sourceHandle),
    )
    const loose = routes.filter((route) => !wired.has(route.id))
    if (loose.length > 0) {
      add(
        `Route${loose.length > 1 ? 's' : ''} ${loose
          .map((route) => route.label || route.id)
          .join(', ')} on a Router ${loose.length > 1 ? 'lead' : 'leads'} nowhere.`,
      )
    }
  }

  if (live.some((node) => node.kind === 'agent' && !node.config.flow)) {
    add('An Agent widget names no flow to run.')
  }

  const unsetSources = retrieving.filter((node) => (node.config.sourceIds ?? []).length === 0)
  if (unsetSources.length > 0) {
    add(
      `${unsetSources.length} connected Source ${
        unsetSources.length === 1 ? 'widget has' : 'widgets have'
      } no sources picked.`,
    )
  }
  if (
    live.some(
      (node) =>
        node.kind === 'source' &&
        node.config.sourceType === 'txt' &&
        !(node.config.text ?? '').trim(),
    )
  ) {
    add('A text Source widget is empty.')
  }

  if (!live.some((node) => node.kind === 'source' || node.kind === 'agent')) {
    add('Wire a Source or an Agent widget through to the Output widget.')
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
  /** Which output the wire leaves from; only a Router has more than one. */
  fromHandle?: string | null,
): string | null {
  if (fromId === toId) return 'A widget cannot connect to itself.'

  const from = graph.nodes.find((node) => node.id === fromId)
  const to = graph.nodes.find((node) => node.id === toId)
  if (!from || !to) return 'That widget is no longer on the canvas.'

  // A flow saved under an older widget vocabulary can hold a kind this build
  // no longer knows. Refusing the wire says so; reading the registry blind
  // would take the canvas down with a TypeError.
  if (!WIDGETS[from.kind] || !WIDGETS[to.kind]) {
    return 'This flow uses a widget this version does not know.'
  }

  if (!WIDGETS[from.kind].outputs) {
    return `${WIDGETS[from.kind].label} has no output to wire from.`
  }
  if (!WIDGETS[to.kind].inputs) {
    return `${WIDGETS[to.kind].label} does not take an input — wire it onwards instead.`
  }
  const sameOutput = graph.edges.filter(
    (edge) => edge.source === fromId && (edge.sourceHandle ?? null) === (fromHandle ?? null),
  )
  if (sameOutput.some((edge) => edge.target === toId)) {
    return `Already wired to ${WIDGETS[to.kind].label}.`
  }
  // A route sends the run to one place. Two wires out of the same route would
  // be a fan-out, which is the opposite of what a Router is for.
  if (from.kind === 'router' && sameOutput.length > 0) {
    const route = (from.config.routes ?? []).find((one) => one.id === fromHandle)
    return `Route ${route?.label ?? ''} already leads somewhere.`.replace('  ', ' ')
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
