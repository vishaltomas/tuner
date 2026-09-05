export type DocumentKind = 'pdf' | 'txt'

export type DocumentStatus = 'queued' | 'embedding' | 'ready' | 'failed'

export interface SourceDocument {
  id: string
  name: string
  /** Size in bytes. */
  size: number
  kind: DocumentKind
  status: DocumentStatus
  /** Number of vectors written for this document, once embedded. */
  chunks?: number
  error?: string
  addedAt: string
}

export interface Source {
  id: string
  /** The name the user gave this upload session. */
  name: string
  description?: string
  /** Hugging Face id of the embedding model used for every doc in this source. */
  model: string
  createdAt: string
  updatedAt: string
  documents: SourceDocument[]
  /** Names of the sources this one was merged from, if any. */
  mergedFrom?: string[]
}

export interface EmbeddingModel {
  id: string
  /** Vector width, when the catalogue knows it. */
  dimensions?: number
  downloads?: number
  library?: string
}

export interface EmbedRequest {
  /** Existing source id to append to, or `null` to create a new one. */
  sourceId: string | null
  name: string
  description?: string
  model: string
  files: File[]
}

export type DownloadStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** A background model download, as the backend reports it while polling. */
export interface DownloadJob {
  id: string
  modelId: string
  status: DownloadStatus
  /** Bytes on disk so far. */
  downloadedBytes: number
  /** Repo size, when the Hub reports per-file sizes. */
  totalBytes?: number | null
  error?: string | null
  createdAt: string
  updatedAt: string
  finishedAt?: string | null
}

/** A model held locally, once its download has finished. */
export interface LocalModel {
  id: string
  sizeBytes?: number | null
  downloadedAt?: string | null
}

/** A turn in the chat transcript, as the browser holds it. */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Passages the answer was given, on assistant turns that had any. */
  citations?: ChatCitation[]
  /** Set on an assistant turn the backend could not produce. */
  error?: boolean
  createdAt: string
}

/**
 * One retrieved passage put in front of the model.
 *
 * `marker` is the number the answer cites in square brackets, so a `[2]` in
 * the text and the citation numbered 2 are the same passage.
 */
export interface ChatCitation {
  marker: number
  chunkId: string
  documentId: string
  sourceId: string
  documentName: string
  /** Pages the passage drew on; empty for a text file, which has none. */
  pages: number[]
  score: number
  /**
   * What `score` measures. Retrieval reports a cosine similarity in [-1, 1];
   * a Reranker reports its own logit, on no fixed scale; a passage a widget
   * handed over was never ranked at all.
   */
  scoreKind?: 'similarity' | 'rerank' | 'given'
  text: string
}

export interface ChatReply {
  answer: string
  citations: ChatCitation[]
  /** The served model that wrote the answer. */
  model: string
}

/** What the chat pane opens with, before the first question is asked. */
export interface ChatDefaults {
  system: string
  model: string
  contextChunks: number
}

/**
 * Kinds of widget a flow can hold.
 *
 * Adding one is an entry in `sections/workflow/widgets.ts`, an icon in
 * `icons.tsx`, and a case here — the canvas, the inspector and the rail all
 * read the registry rather than switching on the kind themselves.
 */
export type WidgetKind =
  | 'input'
  | 'source'
  | 'embed'
  | 'reranker'
  | 'router'
  | 'agent'
  | 'system'
  | 'output'

/** What a Source widget stands for. */
export type SourceType = 'files' | 'txt' | 'chat'

/** How a `files` Source picks its passages. */
export type RetrievalMethod = 'similarity' | 'mmr'

/**
 * What an Input or Output widget carries.
 *
 * `chat` is the conversation itself, which is what `main.flow` is wired to; a
 * payload is text with a declared extension, which is how a called flow takes
 * and returns its work.
 */
export type IoMode = 'chat' | 'payload'
export type PayloadType = 'txt' | 'md' | 'json' | 'csv' | 'html'

/** Per-kind settings. Every field is optional: a widget starts unconfigured. */
export interface WidgetConfig {
  /** `input` and `output`: the conversation, or a typed payload. */
  mode?: IoMode
  /** `input` and `output` in payload mode: what kind of text it carries. */
  payloadType?: PayloadType

  /** `source`: which kind of source this is. Defaults to `files`. */
  sourceType?: SourceType
  /** `source` + `files`: the embedded sources to retrieve from, searched together. */
  sourceIds?: string[]
  /** `source` + `files`: how passages are picked. */
  method?: RetrievalMethod
  /** `source` + `files`: how many passages to retrieve. */
  docs?: number
  /** `source` + `txt`: text put in front of the model as written. */
  text?: string
  /** `source` + `txt`, and `agent`: what the passage is called in a citation. */
  label?: string

  /**
   * `embed` and `reranker`: the model this widget runs.
   * `router`: the model that decides which branch to take. Blank uses the
   * app's configured chat model.
   */
  model?: string
  /** `router`: the branches, one per output handle. */
  routes?: RouteSpec[]
  /** `reranker`: how many passages to keep after reordering. */
  keep?: number

  /** `agent`: the `.flow` file this widget runs as a sub-flow. */
  flow?: string
  /** `system`: the standing instructions. */
  system?: string
}

export interface FlowNode {
  id: string
  kind: WidgetKind
  /** Canvas position, in flow coordinates. */
  position: { x: number; y: number }
  config: WidgetConfig
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  /**
   * Which output of the source widget this wire leaves from. Only a Router
   * has more than one, and it is how a route is told from its siblings.
   */
  sourceHandle?: string | null
}

/** One branch a Router widget can send the run down. */
export interface RouteSpec {
  id: string
  label: string
  /** When to take it, in the words the deciding model is shown. */
  when: string
}

/** The canvas itself. Stored as one `.flow` file; nothing queries inside it. */
export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** One workflow: a directory of flows, with its own `main.flow`. */
export interface Workflow {
  name: string
  /** How many `.flow` files it holds, `main.flow` included. */
  flows: number
  updatedAt: string
}

/** One `.flow` file, as the explorer lists it. */
export interface FlowFile {
  name: string
  size: number
  updatedAt: string
  /** `main.flow` is where a run starts; the explorer pins it to the top. */
  isMain: boolean
}

/** A flow file and what is drawn in it. */
export interface Flow {
  name: string
  isMain: boolean
  graph: FlowGraph
}
