import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useMediaQuery, useTheme } from '@mui/material'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import { EMPTY_GRAPH, MAIN, useFlows, useWorkflows } from '../../hooks/useFlows'
import * as api from '../../lib/api'
import { navigate } from '../../lib/route'
import type { FlowGraph, LocalModel, Source, WidgetConfig, WidgetKind } from '../../lib/types'
import { uid } from '../../lib/utils'
import { ConfirmDialog, NameDialog } from './NameDialog'
import { FlowTree } from './FlowTree'
import { WidgetInspector } from './WidgetInspector'
import { WidgetRail } from './WidgetRail'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WIDGETS, WIDGET_ORDER, resolve } from './widgets'

const FILES_WIDTH = 244
const RAIL_WIDTH = 84
const INSPECTOR_WIDTH = 280
// Below `lg` the inspector has nowhere to sit beside the canvas and drops
// underneath. It is capped hard: the canvas is the point of this page, and a
// panel taking 40% of the height left it too short to lay a graph out in.
const BOTTOM_INSPECTOR_MAX = 196

// Where a click-added widget lands. The step is the widget's own footprint
// plus a gap, so consecutive adds tile instead of stacking — overlapping
// widgets bury each other's handles and a wire cannot be started.
const ADD_ORIGIN = { x: 80, y: 60 }
const NODE_W = 210
const NODE_H = 110
const GAP = 40
const COLUMNS = 3

type Notice = { tone: 'success' | 'error'; text: string } | null

/**
 * The flow editor, as its own page.
 *
 * Full bleed and outside the app shell: three columns and a canvas need the
 * whole viewport, and the sidebar would be spending width on navigation the
 * whole time you are wiring. Reached at `#/workflow`; the back button here and
 * the browser's own both return to the app.
 */
export function WorkflowPage({ sources }: { sources: Source[] }) {
  const workflows = useWorkflows()
  // Which workflow is being edited. Null only before the first list arrives;
  // the backend guarantees at least one exists.
  const [workflow, setWorkflow] = useState<string | null>(null)
  const { files, save, rename, remove, refresh } = useFlows(workflow)

  const [open, setOpen] = useState(MAIN)
  // The name as typed. Committed on Enter or blur, so a half-typed name is
  // never a filename — a rename moves a real file and repoints every Agent
  // widget calling it.
  const [draftName, setDraftName] = useState(MAIN)
  const [graph, setGraph] = useState<FlowGraph>(EMPTY_GRAPH)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Whether the canvas holds edits that are not on disk. A flow is a file, so
  // "saved" is a real question with a real answer, unlike a draft in memory.
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [fitSignal, setFitSignal] = useState(0)
  // Which dialog is open, if any. These were `window.prompt` and
  // `window.confirm`, which a browser stops showing once a page has used a
  // few of them — and then returns null, so creating a flow silently did
  // nothing. See `NameDialog`.
  const [asking, setAsking] = useState<'workflow' | 'renameWorkflow' | 'flow' | null>(
    null,
  )
  const [confirming, setConfirming] = useState(false)
  // Models on disk, offered to the Embed and Reranker widgets. Fetched once:
  // downloading one is a deliberate act elsewhere in the app, not something
  // that happens while a flow is being wired.
  const [models, setModels] = useState<LocalModel[]>([])
  useEffect(() => {
    void (async () => setModels((await api.fetchLocalModels()) ?? []))()
  }, [])

  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null
  // Which side the inspector sits on. Chosen here rather than with `lg:` on
  // two copies: rendering the same form twice puts duplicate input ids and
  // duplicate labels in the DOM, which a screen reader reads as two of
  // everything.
  const theme = useTheme()
  const besideCanvas = useMediaQuery(theme.breakpoints.up('lg'))

  const isMain = open === MAIN
  const { problems, calls } = useMemo(
    () => resolve(graph, { isMain }),
    [graph, isMain],
  )

  const counts = useMemo(() => {
    const tally = Object.fromEntries(WIDGET_ORDER.map((kind) => [kind, 0])) as Record<
      WidgetKind,
      number
    >
    for (const node of graph.nodes) tally[node.kind] += 1
    return tally
  }, [graph.nodes])

  const load = useCallback(
    async (name: string, from?: string) => {
      const where = from ?? workflow
      if (!where) return
      const flow = await api.fetchFlow(where, name)
      setOpen(name)
      setDraftName(name)
      setGraph(flow?.graph ?? EMPTY_GRAPH)
      setSelectedId(null)
      setDirty(false)
      setFitSignal((previous) => previous + 1)
    },
    [workflow],
  )

  // Settle on a workflow as soon as the list arrives, keeping the current one
  // if it is still there — a rename or a delete elsewhere should not throw the
  // editor back to the first in the list for no reason.
  useEffect(() => {
    if (workflows.workflows.length === 0) return
    setWorkflow((previous) =>
      previous && workflows.workflows.some((one) => one.name === previous)
        ? previous
        : workflows.workflows[0].name,
    )
  }, [workflows.workflows])

  // Open main.flow whenever the workflow changes: it is where that workflow's
  // run starts, so it is what the editor should be showing.
  useEffect(() => {
    if (workflow) void load(MAIN)
  }, [workflow, load])

  function edit(next: FlowGraph) {
    setGraph(next)
    setDirty(true)
  }

  /**
   * Why a name cannot be used, mirroring the patterns in `services/flows.py`.
   * Checked here so a refusal appears under the field rather than arriving as
   * a failed request.
   */
  function checkWorkflowName(name: string): string | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name)) {
      return 'Letters, numbers, spaces, dashes and underscores; start with a letter or number.'
    }
    if (workflows.workflows.some((one) => one.name === name)) {
      return 'A workflow with that name already exists.'
    }
    return null
  }

  function checkFlowName(raw: string): string | null {
    const name = raw.endsWith('.flow') ? raw : `${raw}.flow`
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\.flow$/.test(name)) {
      return 'Letters, numbers, spaces, dashes and underscores, ending in .flow.'
    }
    if (files.some((one) => one.name === name)) return `${name} already exists.`
    return null
  }

  /** Place a widget without a pointer, in the first slot nothing occupies. */
  function place(kind: WidgetKind, config: WidgetConfig) {
    const nodeId = uid('node')
    setGraph((previous) => {
      const taken = previous.nodes.map((node) => node.position)
      let position = ADD_ORIGIN
      for (let slot = 0; slot < 60; slot++) {
        const candidate = {
          x: ADD_ORIGIN.x + (slot % COLUMNS) * (NODE_W + GAP),
          y: ADD_ORIGIN.y + Math.floor(slot / COLUMNS) * (NODE_H + GAP),
        }
        const clash = taken.some(
          (one) =>
            Math.abs(one.x - candidate.x) < NODE_W && Math.abs(one.y - candidate.y) < NODE_H,
        )
        if (!clash) {
          position = candidate
          break
        }
      }
      return { ...previous, nodes: [...previous.nodes, { id: nodeId, kind, position, config }] }
    })
    setSelectedId(nodeId)
    setDirty(true)
    setFitSignal((previous) => previous + 1)
  }

  function updateSelected(config: WidgetConfig) {
    edit({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === selectedId ? { ...node, config } : node)),
    })
  }

  function deleteSelected() {
    edit({
      nodes: graph.nodes.filter((node) => node.id !== selectedId),
      edges: graph.edges.filter(
        (edge) => edge.source !== selectedId && edge.target !== selectedId,
      ),
    })
    setSelectedId(null)
  }

  async function createWorkflow(name: string) {
    setAsking(null)
    setBusy(true)
    try {
      const made = await workflows.create(name)
      setWorkflow(made.name)
      setNotice({ tone: 'success', text: `Created ${made.name}.` })
    } catch {
      setNotice({ tone: 'error', text: `Could not create ${name}.` })
    } finally {
      setBusy(false)
    }
  }

  async function renameWorkflow(next: string) {
    setAsking(null)
    if (!workflow || next === workflow) return
    setBusy(true)
    try {
      const renamed = await workflows.rename(workflow, next)
      setWorkflow(renamed.name)
      setNotice({ tone: 'success', text: `Renamed to ${renamed.name}.` })
    } catch {
      setNotice({ tone: 'error', text: `Could not rename to ${next}.` })
    } finally {
      setBusy(false)
    }
  }

  async function deleteWorkflow() {
    setConfirming(false)
    if (!workflow) return
    setBusy(true)
    try {
      await workflows.remove(workflow)
      setWorkflow(null)
      setNotice({ tone: 'success', text: `Deleted ${workflow}.` })
    } catch {
      setNotice({
        tone: 'error',
        text: 'Could not delete it — a workflow has to remain for Chat to run.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function createFlow(raw: string) {
    setAsking(null)
    const name = raw.endsWith('.flow') ? raw : `${raw}.flow`
    setBusy(true)
    try {
      await save(name, EMPTY_GRAPH)
      await load(name)
      setNotice({ tone: 'success', text: `Created ${name}.` })
    } catch {
      setNotice({ tone: 'error', text: `Could not create ${name}.` })
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    setBusy(true)
    try {
      await save(open, graph)
      setDirty(false)
      setNotice({ tone: 'success', text: `Saved ${open}.` })
    } catch {
      setNotice({ tone: 'error', text: `Could not save ${open}.` })
    } finally {
      setBusy(false)
    }
  }

  /** Commit a rename, or put the field back if it cannot be done. */
  async function commitName() {
    const raw = draftName.trim()
    const next = raw.endsWith('.flow') ? raw : `${raw}.flow`
    if (!raw || next === open) {
      setDraftName(open)
      return
    }
    setBusy(true)
    try {
      // Save first: a rename moves what is on disk, and unsaved edits on the
      // canvas would be left behind under the old name.
      if (dirty) await save(open, graph)
      await rename(open, next)
      setOpen(next)
      setDraftName(next)
      setDirty(false)
      setNotice({ tone: 'success', text: `Renamed to ${next}.` })
    } catch {
      setDraftName(open)
      setNotice({ tone: 'error', text: `Could not rename to ${next}.` })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(name: string) {
    await remove(name)
    if (name === open) await load(MAIN)
    else await refresh()
  }

  // Built once and placed on whichever side fits; see `besideCanvas`.
  const inspector = selected ? (
    <WidgetInspector
      node={selected}
      sources={sources}
      models={models}
      flows={files}
      openFlow={open}
      isMain={isMain}
      onChange={updateSelected}
      onDelete={deleteSelected}
    />
  ) : null

  return (
    <Box className="flex h-full flex-col" sx={{ bgcolor: 'background.default' }}>
      <Box
        className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2"
        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Tooltip title="Back to Tuner">
          <IconButton size="small" aria-label="Back to Tuner" onClick={() => navigate('app')}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
        <TextField
          select
          value={workflow ?? ''}
          disabled={busy || workflows.workflows.length === 0}
          onChange={(event) => setWorkflow(event.target.value)}
          sx={{ width: 190 }}
          slotProps={{ htmlInput: { 'aria-label': 'Workflow' } }}
        >
          {workflows.workflows.map((one) => (
            <MenuItem key={one.name} value={one.name}>
              {one.name}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="New workflow">
          <IconButton size="small" aria-label="New workflow" onClick={() => setAsking('workflow')}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Rename workflow">
          <IconButton
            size="small"
            aria-label="Rename workflow"
            onClick={() => setAsking('renameWorkflow')}
          >
            <DriveFileRenameOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete workflow">
          <IconButton
            size="small"
            aria-label="Delete workflow"
            onClick={() => setConfirming(true)}
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Tooltip
          title={open === MAIN ? 'main.flow is the entry point and cannot be renamed' : ''}
        >
          <TextField
            value={draftName}
            disabled={open === MAIN || busy}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              // `event.target`, not `currentTarget`: MUI forwards onKeyDown to
              // the wrapping div, and blurring a div that never had focus does
              // nothing — which left Enter doing nothing at all.
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setDraftName(open)
            }}
            sx={{ width: 190, '& input': { fontFamily: 'var(--font-mono)', fontSize: 13 } }}
            // On the input rather than the field: MUI puts a bare `aria-label`
            // on the wrapping div, where a screen reader never reaches it.
            slotProps={{ htmlInput: { maxLength: 64, 'aria-label': 'Flow name' } }}
          />
        </Tooltip>
        {dirty && (
          <Tooltip title="Unsaved changes">
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main' }} />
          </Tooltip>
        )}
        {isMain && (
          <Tooltip title="Chat runs this flow">
            <Chip label="entry point" color="success" variant="outlined" />
          </Tooltip>
        )}

        <Button
          size="small"
          startIcon={<AddIcon fontSize="small" />}
          onClick={() => setAsking('flow')}
          disabled={busy}
        >
          New flow
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<SaveOutlinedIcon fontSize="small" />}
          onClick={() => void handleSave()}
          disabled={busy || !dirty}
        >
          Save
        </Button>

        <Box className="ml-auto flex items-center gap-1.5">
          {calls.length > 0 && (
            <Chip label={`calls ${calls.join(', ')}`} color="secondary" variant="outlined" />
          )}
          <Tooltip title={problems.join(' ') || 'This flow can answer a question'}>
            <Chip
              label={problems.length === 0 ? 'Ready' : 'Incomplete'}
              color={problems.length === 0 ? 'success' : 'warning'}
              variant="outlined"
            />
          </Tooltip>
        </Box>
      </Box>

      <Box className="flex min-h-0 flex-1">
        {/* Left: the flow files */}
        <Box
          className="flex shrink-0 flex-col"
          sx={{
            width: FILES_WIDTH,
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            className="shrink-0 px-3 pt-2.5 pb-1.5"
            sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            {workflow ?? 'Flows'}
          </Typography>
          <Divider />
          <Box className="min-h-0 flex-1 overflow-y-auto px-1.5">
            <FlowTree
              files={files}
              open={open}
              called={calls}
              dirty={dirty}
              onOpen={(name) => void load(name)}
              onCreate={() => setAsking('flow')}
              onDelete={(name) => void handleDelete(name)}
            />
          </Box>
        </Box>

        {/* Middle: the canvas */}
        <Box className="relative flex min-w-0 flex-1 flex-col">
          {problems.length > 0 && (
            <Alert severity="info" square sx={{ py: 0.25 }}>
              {problems[0]}
            </Alert>
          )}
          <Box className="min-h-[280px] flex-1">
            {/* The provider owns the viewport state `screenToFlowPosition`
                reads, so it has to sit above the canvas, not inside it. */}
            <ReactFlowProvider>
              <WorkflowCanvas
                graph={graph}
                sources={sources}
                selectedId={selectedId}
                fitSignal={fitSignal}
                onGraphChange={edit}
                onSelect={setSelectedId}
              />
            </ReactFlowProvider>
          </Box>
        </Box>

        {selected && besideCanvas && (
          <Box
            className="flex shrink-0 flex-col overflow-y-auto"
            sx={{
              width: INSPECTOR_WIDTH,
              borderLeft: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            {inspector}
          </Box>
        )}

        <Box
          className="flex shrink-0 flex-col overflow-y-auto"
          sx={{
            width: RAIL_WIDTH,
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            className="shrink-0 px-1 pt-2.5 pb-1.5 text-center"
            sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            Widgets
          </Typography>
          <Divider />
          <WidgetRail counts={counts} onAdd={(kind) => place(kind, { ...WIDGETS[kind].defaults })} />
        </Box>
      </Box>

      {/* Only below `lg`, where there is no room for it beside the canvas. */}
      {selected && !besideCanvas && (
        <Box
          className="shrink-0 overflow-y-auto"
          sx={{
            maxHeight: BOTTOM_INSPECTOR_MAX,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {inspector}
        </Box>
      )}

      <NameDialog
        open={asking === 'workflow'}
        title="New workflow"
        label="Workflow name"
        initial=""
        submitLabel="Create"
        validate={checkWorkflowName}
        onSubmit={(name) => void createWorkflow(name)}
        onClose={() => setAsking(null)}
      />
      <NameDialog
        open={asking === 'renameWorkflow'}
        title="Rename workflow"
        label="Workflow name"
        initial={workflow ?? ''}
        submitLabel="Rename"
        validate={(name) => (name === workflow ? null : checkWorkflowName(name))}
        onSubmit={(name) => void renameWorkflow(name)}
        onClose={() => setAsking(null)}
      />
      <NameDialog
        open={asking === 'flow'}
        title="New flow"
        label="Flow name"
        initial=""
        submitLabel="Create"
        validate={checkFlowName}
        onSubmit={(name) => void createFlow(name)}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={confirming}
        title={`Delete ${workflow ?? ''}?`}
        body="Every flow in it goes too. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => void deleteWorkflow()}
        onClose={() => setConfirming(false)}
      />

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.tone === 'error' ? 'error' : 'success'}
          variant="outlined"
          onClose={() => setNotice(null)}
          sx={{ bgcolor: 'background.paper' }}
        >
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  )
}
