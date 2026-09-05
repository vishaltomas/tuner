import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useConnection,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Box, Typography } from '@mui/material'
import type { FlowGraph, Source, WidgetConfig, WidgetKind } from '../../lib/types'
import { totalChunks, uid } from '../../lib/utils'
import { WidgetNode, type WidgetNodeData } from './WidgetNode'
import { WireEdge, type WireEdgeData } from './WireEdge'
import { DRAG_TYPE, WIDGETS, connectionIssue, resolve } from './widgets'

const NODE_TYPES = { widget: WidgetNode }
const EDGE_TYPES = { wire: WireEdge }

interface WorkflowCanvasProps {
  graph: FlowGraph
  sources: Source[]
  selectedId: string | null
  /**
   * Bumped whenever a widget is added without a pointer. A click-added node is
   * placed in graph coordinates with no way to know what the viewport is
   * currently showing, so it can land off-screen — and the panes either side
   * sit over the canvas edges, leaving it unreachable. Refitting on the bump
   * guarantees whatever was just added is on screen and can be wired.
   */
  fitSignal: number
  onGraphChange: (graph: FlowGraph) => void
  onSelect: (nodeId: string | null) => void
}

/**
 * The editable graph.
 *
 * The stored `FlowGraph` is the source of truth, not React Flow's own
 * state: it is what gets saved, and it is a far smaller shape than the one
 * React Flow works in. So every interaction converts out, applies the change,
 * and hands a plain graph back up — the flow nodes below are derived on each
 * render and never held.
 */
export function WorkflowCanvas({
  graph,
  sources,
  selectedId,
  fitSignal,
  onGraphChange,
  onSelect,
}: WorkflowCanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow()

  useEffect(() => {
    if (fitSignal === 0) return
    void fitView({ duration: 220, maxZoom: 1, padding: 0.25 })
  }, [fitSignal, fitView])

  // React Flow measures every node and reports it as a `dimensions` change,
  // and keeps a node `visibility: hidden` until it knows its size — see
  // `nodeHasDimensions`. The saved graph has no room for a measurement (it is
  // not something the user authored) and these nodes are rebuilt from it on
  // every render, so without somewhere to keep them the measurement is thrown
  // away each time and the node never becomes visible at all.
  const [measured, setMeasured] = useState<
    Record<string, { width: number; height: number }>
  >({})

  // Which wire the pointer is over. A wire shows its remove button only then,
  // so the canvas is not littered with controls for something not being
  // touched.
  const [hovered, setHovered] = useState<string | null>(null)

  // Which wire is selected, held here rather than left to React Flow. This
  // canvas is controlled: every render hands React Flow a fresh `edges` array
  // built from `graph`, which would overwrite a selection it was keeping
  // internally. The nodes are selected the same way, for the same reason.
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)

  // Only the id is taken from the connection store, so a pointer move during
  // a drag does not re-render the canvas for coordinates it never reads.
  const connectingFrom = useConnection((connection) =>
    connection.inProgress ? connection.fromNode.id : null,
  )
  const connectingHandle = useConnection((connection) =>
    connection.inProgress ? (connection.fromHandle?.id ?? null) : null,
  )

  const { reachable } = useMemo(() => resolve(graph), [graph])
  const sourceNames = useMemo(
    () => new Map(sources.map((one) => [one.id, one])),
    [sources],
  )

  const nodes: Node<WidgetNodeData>[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'widget',
        position: node.position,
        measured: measured[node.id],
        selected: node.id === selectedId,
        data: {
          kind: node.kind,
          config: node.config,
          live: reachable.has(node.id),
          summary: summarise(node.kind, node.config, sourceNames),
          warning: warningFor(node.kind, node.config, sourceNames),
          routes: node.kind === 'router' ? (node.config.routes ?? []) : undefined,
          // Computed for the whole canvas while a wire is in flight, so each
          // node can explain a refusal without knowing about the graph.
          connectIssue:
            connectingFrom && connectingFrom !== node.id
              ? (connectionIssue(graph, connectingFrom, node.id, connectingHandle) ??
                undefined)
              : undefined,
        },
      })),
    [connectingFrom, connectingHandle, graph, measured, reachable, selectedId, sourceNames],
  )

  const removeEdge = useCallback(
    (id: string) => {
      onGraphChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== id) })
      setHovered(null)
      setSelectedEdge(null)
    },
    [graph, onGraphChange],
  )

  const edges: Edge<WireEdgeData>[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        type: 'wire',
        sourceHandle: edge.sourceHandle ?? undefined,
        animated: reachable.has(edge.target),
        selected: edge.id === selectedEdge,
        data: { active: hovered === edge.id, onDelete: removeEdge },
      })),
    [graph.edges, hovered, reachable, removeEdge, selectedEdge],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<WidgetNodeData>>[]) => {
      // Kept out of the graph and merged back in above. Only written when a
      // size actually changed, so a re-measure reporting the same numbers
      // cannot bounce between render and state update forever.
      setMeasured((previous) => {
        let next = previous
        for (const change of changes) {
          if (change.type !== 'dimensions' || !change.dimensions) continue
          const known = previous[change.id]
          const { width, height } = change.dimensions
          if (known && known.width === width && known.height === height) continue
          if (next === previous) next = { ...previous }
          next[change.id] = { width, height }
        }
        return next
      })

      const next = applyNodeChanges(changes, nodes)
      const positions = new Map(next.map((one) => [one.id, one.position]))
      // Removals are applied by keeping only what survived, so a node deleted
      // with the keyboard goes the same way as one deleted from the inspector.
      const keptNodes = graph.nodes
        .filter((node) => positions.has(node.id))
        .map((node) => ({ ...node, position: positions.get(node.id)! }))
      const keptEdges = graph.edges.filter(
        (edge) => positions.has(edge.source) && positions.has(edge.target),
      )

      // A measurement is not an edit. Reporting one as a graph change marked
      // a freshly opened flow as unsaved before the user had touched it, and
      // lit the Save button on a file identical to the one on disk.
      const unchanged =
        keptNodes.length === graph.nodes.length &&
        keptEdges.length === graph.edges.length &&
        keptNodes.every(
          (node, index) =>
            node.position.x === graph.nodes[index].position.x &&
            node.position.y === graph.nodes[index].position.y,
        )
      if (unchanged) return

      onGraphChange({ nodes: keptNodes, edges: keptEdges })
    },
    [graph, nodes, onGraphChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge<WireEdgeData>>[]) => {
      const kept = new Set(applyEdgeChanges(changes, edges).map((one) => one.id))
      // Selecting a wire is not an edit. Reporting one as a graph change both
      // lit the Save button on an untouched flow and, because the rebuilt
      // `edges` carry no selection, threw the selection away again before
      // Delete could act on it.
      if (kept.size === graph.edges.length) return
      onGraphChange({ ...graph, edges: graph.edges.filter((edge) => kept.has(edge.id)) })
    },
    [edges, graph, onGraphChange],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const next = addEdge({ ...connection, id: uid('edge') }, edges)
      onGraphChange({
        ...graph,
        edges: next.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          // Which of a Router's outputs the wire left from. Dropping this
          // would make every route look like the same branch.
          sourceHandle: edge.sourceHandle ?? null,
        })),
      })
    },
    [edges, graph, onGraphChange],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      // Dropped where the pointer is, in flow coordinates, so a node lands
      // under the cursor whatever the canvas is panned or zoomed to.
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = uid('node')

      const kind = event.dataTransfer.getData(DRAG_TYPE) as WidgetKind
      if (!kind || !WIDGETS[kind]) return

      const spec = WIDGETS[kind]
      const already = graph.nodes.filter((node) => node.kind === kind).length
      if (spec.max !== undefined && already >= spec.max) return

      onGraphChange({
        ...graph,
        nodes: [...graph.nodes, { id, kind, position, config: { ...spec.defaults } }],
      })
      onSelect(id)
    },
    [graph, onGraphChange, onSelect, screenToFlowPosition],
  )

  return (
    <Box
      className="relative h-full w-full"
      onDragOver={(event) => {
        // Only claim drags this canvas can actually take. Calling
        // preventDefault unconditionally would have it swallow OS file drags
        // and selected text too, which then land as a silent no-op.
        // Only claim drags this canvas can take. Calling preventDefault
        // unconditionally would have it swallow OS file drags and selected
        // text too, which then land as a silent no-op.
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        // Has to match the `effectAllowed` the drag was started with — a
        // dropEffect the drag does not permit is refused by the browser, and
        // the drop never fires at all.
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={onDrop}
      sx={{
        // React Flow ships light-theme colours; point its variables at the
        // MUI palette so the canvas follows the app's theme.
        '& .react-flow': {
          '--xy-background-color': 'transparent',
          '--xy-edge-stroke': 'var(--mui-palette-text-secondary)',
          '--xy-edge-stroke-selected': 'var(--mui-palette-primary-main)',
          '--xy-handle-background-color': 'var(--mui-palette-primary-main)',
          '--xy-handle-border-color': 'var(--mui-palette-background-paper)',
        },
        // Handles are the whole connection affordance, and at 9px they are a
        // hard target — worse, an overlapping node's body covers a neighbour's
        // handle and the connection cannot be started at all. The pseudo
        // element widens what the pointer can grab without changing what is
        // drawn, and the z-index lifts them clear of any node body.
        '& .react-flow__handle': {
          width: 11,
          height: 11,
          zIndex: 20,
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: -9,
            borderRadius: '50%',
          },
        },
        // The zoom and fit buttons. React Flow ships a light and a dark set of
        // defaults but picks between them with a class of its own, which this
        // app never sets — so on a dark canvas they stayed white. Pointing the
        // variables at the MUI palette makes them follow the app's theme
        // instead, in both schemes and with no class to keep in sync.
        '& .react-flow__controls': {
          '--xy-controls-button-background-color': 'var(--mui-palette-background-paper)',
          '--xy-controls-button-background-color-hover':
            'var(--mui-palette-background-default)',
          '--xy-controls-button-color': 'var(--mui-palette-text-secondary)',
          '--xy-controls-button-color-hover': 'var(--mui-palette-primary-main)',
          '--xy-controls-button-border-color': 'var(--mui-palette-divider)',
          '--xy-controls-box-shadow': 'none',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          overflow: 'hidden',
        },
        // The icons are SVG paths with their own fill; without this they keep
        // React Flow's colour while the button around them follows the theme.
        '& .react-flow__controls-button svg': {
          fill: 'currentColor',
          maxWidth: 12,
          maxHeight: 12,
        },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        // React Flow binds only Backspace by default, which is the key most
        // people do not reach for. Both work; the button on the wire is what
        // makes it discoverable at all.
        deleteKeyCode={['Backspace', 'Delete']}
        onEdgeMouseEnter={(_, edge) => setHovered(edge.id)}
        onEdgeMouseLeave={() => setHovered(null)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        // The same rule the nodes explain, so what is refused and what is
        // said about the refusal cannot drift apart.
        isValidConnection={(connection) =>
          Boolean(connection.source) &&
          Boolean(connection.target) &&
          connectionIssue(
            graph,
            connection.source,
            connection.target,
            connection.sourceHandle,
          ) === null
        }
        // Selecting one thing deselects the other, so Delete has a single,
        // obvious target rather than quietly taking a widget and a wire.
        onEdgeClick={(_, edge) => {
          setSelectedEdge(edge.id)
          onSelect(null)
        }}
        onNodeClick={(_, node) => {
          setSelectedEdge(null)
          onSelect(node.id)
        }}
        onPaneClick={() => {
          setSelectedEdge(null)
          onSelect(null)
        }}
        fitView
        // Without a ceiling, fitting a single node zooms it to ~2x, which
        // makes every node huge and trivial to drop on top of another.
        fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {graph.nodes.length === 0 && (
        <Box className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Typography variant="body2" color="text.secondary" className="max-w-xs text-center">
            Drag widgets from the rail on the right onto this canvas, then wire them through
            to an Answer widget.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/** One line describing a widget's current state, shown on the node itself. */
function summarise(
  kind: WidgetKind,
  config: WidgetConfig,
  sources: Map<string, Source>,
): string {
  if (kind === 'input' || kind === 'output') {
    const mode = config.mode ?? 'chat'
    if (mode === 'chat') return kind === 'input' ? 'The chat question' : 'The chat answer'
    return `Payload · .${config.payloadType ?? 'txt'}`
  }

  if (kind === 'source') {
    const type = config.sourceType ?? 'files'
    if (type === 'chat') return 'The conversation so far'
    if (type === 'txt') {
      const text = config.text?.trim()
      return text ? `“${text.slice(0, 55)}${text.length > 55 ? '…' : ''}”` : 'No text yet'
    }
    const picked = config.sourceIds ?? []
    if (picked.length === 0) return 'No sources picked'
    const names = picked.map((id) => sources.get(id)?.name).filter(Boolean)
    const method = config.method === 'mmr' ? 'MMR' : 'similarity'
    return `${names.join(', ') || `${picked.length} sources`} · ${config.docs ?? 6} docs, ${method}`
  }

  if (kind === 'embed') return config.model || "Its sources' own model"
  if (kind === 'reranker') {
    if (!config.model) return 'No model picked'
    return config.keep ? `${config.model} · keep ${config.keep}` : config.model
  }
  if (kind === 'router') {
    const routes = config.routes ?? []
    return `${routes.length} routes · ${config.model || 'app chat model'}`
  }
  if (kind === 'agent') return config.flow ? `Runs ${config.flow}` : 'No flow picked'
  return config.system?.trim() || 'Backend default'
}

/** Why a widget cannot be used yet, if it cannot. */
function warningFor(
  kind: WidgetKind,
  config: WidgetConfig,
  sources: Map<string, Source>,
): string | undefined {
  if (kind === 'agent') return config.flow ? undefined : 'No flow picked'
  // An Embed widget with no model borrows its sources'; a Reranker has
  // nothing to borrow, so it needs one named.
  if (kind === 'reranker') return config.model ? undefined : 'No model picked'
  if (kind === 'router') {
    const routes = config.routes ?? []
    if (routes.length < 2) return 'Needs at least two routes'
    if (routes.some((route) => !route.when.trim())) return 'A route says no condition'
    return undefined
  }
  if (kind !== 'source') return undefined

  const type = config.sourceType ?? 'files'
  if (type === 'chat') return undefined
  if (type === 'txt') return config.text?.trim() ? undefined : 'No text yet'

  const picked = config.sourceIds ?? []
  if (picked.length === 0) return 'No sources picked'
  const missing = picked.filter((id) => !sources.has(id))
  if (missing.length > 0) return 'A source no longer exists'
  if (picked.some((id) => totalChunks(sources.get(id)!.documents) === 0)) {
    return 'A source has no vectors yet'
  }
  return undefined
}
