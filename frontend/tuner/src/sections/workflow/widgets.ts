import type {
  IoMode,
  PayloadType,
  RetrievalMethod,
  SourceType,
  WidgetConfig,
  WidgetKind,
} from '../../lib/types'

/**
 * What one kind of widget is and how it may be wired.
 *
 * Everything else in this section reads the registry rather than switching on
 * the kind: the rail lists it, the canvas draws it, the inspector edits it, and
 * `resolve` walks it. Adding a widget is an entry here, an icon in `icons.tsx`,
 * and a `WidgetKind` — nothing else has to learn about it.
 *
 * Deliberately free of JSX so the wiring rules below can be exercised without
 * a renderer; the icons live next door in `icons.tsx`.
 */
export interface WidgetSpec {
  kind: WidgetKind
  label: string
  /** One line, shown in the palette and under the inspector heading. */
  blurb: string
  /** Accent used for the node's border and its rail entry. */
  tone: 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'error'
  /** Whether the node takes a wire in, gives one out, or both. */
  inputs: boolean
  outputs: boolean
  /** How many may exist. `answer` is the single terminal node. */
  max?: number
  defaults: WidgetConfig
}

export const WIDGETS: Record<WidgetKind, WidgetSpec> = {
  input: {
    kind: 'input',
    label: 'Input',
    blurb: 'Where a run starts. In main.flow this is the chat question.',
    tone: 'success',
    inputs: false,
    outputs: true,
    max: 1,
    defaults: { mode: 'chat' },
  },
  source: {
    kind: 'source',
    label: 'Source',
    blurb: 'Where the answer comes from: files, text, or the chat.',
    tone: 'primary',
    inputs: true,
    outputs: true,
    defaults: { sourceType: 'files', sourceIds: [], method: 'similarity', docs: 6 },
  },
  embed: {
    kind: 'embed',
    label: 'Embed',
    blurb: 'Turns the question into a vector to search with.',
    tone: 'info',
    inputs: true,
    outputs: true,
    max: 1,
    defaults: {},
  },
  reranker: {
    kind: 'reranker',
    label: 'Reranker',
    blurb: 'Reorders retrieved passages with a cross-encoder.',
    tone: 'warning',
    inputs: true,
    outputs: true,
    max: 1,
    defaults: {},
  },
  router: {
    kind: 'router',
    label: 'Router',
    blurb: 'Sends the run down one branch. The others are skipped.',
    tone: 'error',
    inputs: true,
    outputs: true,
    defaults: {
      routes: [
        { id: 'a', label: 'First', when: '' },
        { id: 'b', label: 'Otherwise', when: 'anything else' },
      ],
    },
  },
  agent: {
    kind: 'agent',
    label: 'Agent',
    blurb: 'Runs another flow and hands back what it answered.',
    tone: 'secondary',
    inputs: true,
    outputs: true,
    defaults: {},
  },
  system: {
    kind: 'system',
    label: 'System message',
    blurb: 'Standing instructions sent ahead of every question.',
    tone: 'warning',
    inputs: false,
    outputs: true,
    max: 1,
    defaults: { system: '' },
  },
  output: {
    kind: 'output',
    label: 'Output',
    blurb: 'Where a run ends. In main.flow this is the chat answer.',
    tone: 'success',
    inputs: true,
    outputs: false,
    max: 1,
    defaults: { mode: 'chat' },
  },
}

export const WIDGET_ORDER: WidgetKind[] = [
  'input',
  'source',
  'embed',
  'reranker',
  'router',
  'agent',
  'system',
  'output',
]

/** What a Source widget can be, in the order the inspector offers them. */
export const SOURCE_TYPES: { value: SourceType; label: string; blurb: string }[] = [
  { value: 'files', label: 'Files', blurb: 'Embedded sources, searched for the question.' },
  { value: 'txt', label: 'Text', blurb: 'Text you type here, used as written.' },
  { value: 'chat', label: 'Chat', blurb: 'The conversation so far.' },
]

/** How a `files` Source picks its passages. */
export const RETRIEVAL_METHODS: {
  value: RetrievalMethod
  label: string
  blurb: string
}[] = [
  {
    value: 'similarity',
    label: 'Similarity',
    blurb: 'The passages closest to the question.',
  },
  {
    value: 'mmr',
    label: 'MMR',
    blurb: 'Relevant passages that differ from each other, so a repetitive corpus does not fill the budget with near-copies.',
  },
]

/** What an Input or Output widget carries. */
export const IO_MODES: { value: IoMode; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'payload', label: 'Payload' },
]

export const PAYLOAD_TYPES: PayloadType[] = ['txt', 'md', 'json', 'csv', 'html']

/** MIME type carrying a widget kind from the rail to the canvas. */
export const DRAG_TYPE = 'application/tuner-widget'

export { connectionIssue, resolve } from './resolve'
