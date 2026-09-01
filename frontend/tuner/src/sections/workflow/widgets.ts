import type { SourceType, WidgetConfig, WidgetKind } from '../../lib/types'

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
  tone: 'primary' | 'secondary' | 'success' | 'warning' | 'info'
  /** Whether the node takes a wire in, gives one out, or both. */
  inputs: boolean
  outputs: boolean
  /** How many may exist. `answer` is the single terminal node. */
  max?: number
  defaults: WidgetConfig
}

export const WIDGETS: Record<WidgetKind, WidgetSpec> = {
  source: {
    kind: 'source',
    label: 'Source',
    blurb: 'Where the answer comes from: files, text, or the chat.',
    tone: 'primary',
    inputs: false,
    outputs: true,
    defaults: { sourceType: 'files' },
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
  retrieval: {
    kind: 'retrieval',
    label: 'Retrieval',
    blurb: 'How many passages each answer sees.',
    tone: 'info',
    inputs: true,
    outputs: true,
    max: 1,
    defaults: { topK: 6 },
  },
  answer: {
    kind: 'answer',
    label: 'Answer',
    blurb: 'Where the conversation happens. Every flow ends here.',
    tone: 'success',
    inputs: true,
    outputs: false,
    max: 1,
    defaults: {},
  },
}

export const WIDGET_ORDER: WidgetKind[] = [
  'source',
  'agent',
  'system',
  'retrieval',
  'answer',
]

/** What a Source widget can be, in the order the inspector offers them. */
export const SOURCE_TYPES: { value: SourceType; label: string; blurb: string }[] = [
  { value: 'files', label: 'Files', blurb: 'An embedded source from Embed Documents.' },
  { value: 'txt', label: 'Text', blurb: 'Text you type here, used as written.' },
  { value: 'chat', label: 'Chat', blurb: 'The conversation so far.' },
]

/** MIME type carrying a widget kind from the rail to the canvas. */
export const DRAG_TYPE = 'application/tuner-widget'

export { connectionIssue, resolve } from './resolve'
