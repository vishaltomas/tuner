import type {
  ChatDefaults,
  ChatReply,
  ChatTurn,
  DownloadJob,
  EmbeddingModel,
  LocalModel,
  Flow,
  FlowFile,
  FlowGraph,
  Source,
  Workflow,
} from './types'

const BASE = '/api'

export type BackendStatus = 'checking' | 'online' | 'offline'

let status: BackendStatus = 'checking'
const watchers = new Set<(next: BackendStatus) => void>()

export function getBackendStatus(): BackendStatus {
  return status
}

export function watchBackendStatus(fn: (next: BackendStatus) => void): () => void {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

function setStatus(next: BackendStatus) {
  if (next === status) return
  status = next
  for (const fn of watchers) fn(next)
}

/**
 * Call the backend, returning `null` whenever the answer cannot be trusted.
 *
 * A `null` covers three cases the caller handles the same way — the server is
 * down, the route does not exist yet, or it answered with a shape we do not
 * recognise (several `/embed` routes are still stubs that return no body).
 * Every caller falls back to local state on `null`, so the section keeps
 * working ahead of the backend.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  isValid: (data: unknown) => data is T,
): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      setStatus(response.status >= 500 ? 'offline' : 'online')
      return null
    }
    const data: unknown = await response.json()
    setStatus('online')
    return isValid(data) ? data : null
  } catch {
    setStatus('offline')
    return null
  }
}

const isSource = (data: unknown): data is Source =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as Source).id === 'string' &&
  Array.isArray((data as Source).documents)

const isSourceList = (data: unknown): data is Source[] =>
  Array.isArray(data) && data.every(isSource)

const isModelList = (data: unknown): data is EmbeddingModel[] =>
  Array.isArray(data) &&
  data.every(
    (item) =>
      typeof item === 'object' && item !== null && typeof (item as EmbeddingModel).id === 'string',
  )

/**
 * Embedding models offered before the Hub catalogue answers.
 *
 * Mirrors what `hf_api.list_embed_models` searches for — sentence-transformers
 * feature-extraction models — so the ids stay valid once the route is live.
 */
export const FALLBACK_MODELS: EmbeddingModel[] = [
  { id: 'sentence-transformers/all-MiniLM-L6-v2', dimensions: 384, library: 'sentence-transformers' },
  { id: 'sentence-transformers/all-mpnet-base-v2', dimensions: 768, library: 'sentence-transformers' },
  { id: 'BAAI/bge-small-en-v1.5', dimensions: 384, library: 'sentence-transformers' },
  { id: 'BAAI/bge-base-en-v1.5', dimensions: 768, library: 'sentence-transformers' },
  { id: 'BAAI/bge-large-en-v1.5', dimensions: 1024, library: 'sentence-transformers' },
  { id: 'intfloat/e5-base-v2', dimensions: 768, library: 'sentence-transformers' },
  { id: 'intfloat/multilingual-e5-large', dimensions: 1024, library: 'sentence-transformers' },
  { id: 'thenlper/gte-base', dimensions: 768, library: 'sentence-transformers' },
  { id: 'nomic-ai/nomic-embed-text-v1.5', dimensions: 768, library: 'sentence-transformers' },
  { id: 'mixedbread-ai/mxbai-embed-large-v1', dimensions: 1024, library: 'sentence-transformers' },
]

export async function fetchModels(search: string): Promise<EmbeddingModel[] | null> {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
  return request(`/models${query}`, { method: 'GET' }, isModelList)
}

export async function fetchSources(): Promise<Source[] | null> {
  return request('/sources', { method: 'GET' }, isSourceList)
}

export interface EmbedPayload {
  sourceId: string | null
  name: string
  description?: string
  model: string
  files: File[]
}

export async function embedDocuments(payload: EmbedPayload): Promise<Source | null> {
  const body = new FormData()
  body.append('name', payload.name)
  body.append('model', payload.model)
  if (payload.sourceId) body.append('source_id', payload.sourceId)
  if (payload.description) body.append('description', payload.description)
  for (const file of payload.files) body.append('files', file, file.name)

  return request('/embed', { method: 'POST', body }, isSource)
}

export async function mergeSources(
  sourceIds: string[],
  name: string,
  keepOriginals: boolean,
): Promise<Source | null> {
  return request(
    '/sources/merge',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_ids: sourceIds, name, keep_originals: keepOriginals }),
    },
    isSource,
  )
}

export async function deleteSource(sourceId: string): Promise<boolean> {
  const result = await request(
    `/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE' },
    (data): data is { ok: true } =>
      typeof data === 'object' && data !== null && (data as { ok?: unknown }).ok === true,
  )
  return result !== null
}

export async function deleteDocument(sourceId: string, documentId: string): Promise<boolean> {
  const result = await request(
    `/sources/${encodeURIComponent(sourceId)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE' },
    (data): data is { ok: true } =>
      typeof data === 'object' && data !== null && (data as { ok?: unknown }).ok === true,
  )
  return result !== null
}

const isDownloadJob = (data: unknown): data is DownloadJob =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as DownloadJob).id === 'string' &&
  typeof (data as DownloadJob).status === 'string'

const isLocalModelList = (data: unknown): data is LocalModel[] =>
  Array.isArray(data) &&
  data.every(
    (item) =>
      typeof item === 'object' && item !== null && typeof (item as LocalModel).id === 'string',
  )

/**
 * Queue a download and return the job to poll.
 *
 * The backend answers as soon as the job exists — the repo itself is fetched
 * in the background, so this returns long before the model is on disk.
 */
export async function startModelDownload(modelId: string): Promise<DownloadJob | null> {
  return request(
    '/models/download',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId }),
    },
    isDownloadJob,
  )
}

export async function fetchDownloadJob(jobId: string): Promise<DownloadJob | null> {
  return request(`/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, isDownloadJob)
}

export async function fetchLocalModels(): Promise<LocalModel[] | null> {
  return request('/models/downloaded', { method: 'GET' }, isLocalModelList)
}

const isChatReply = (data: unknown): data is ChatReply =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as ChatReply).answer === 'string' &&
  Array.isArray((data as ChatReply).citations)

const isChatDefaults = (data: unknown): data is ChatDefaults =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as ChatDefaults).system === 'string' &&
  typeof (data as ChatDefaults).model === 'string'

export async function fetchChatDefaults(): Promise<ChatDefaults | null> {
  return request('/chat/defaults', { method: 'GET' }, isChatDefaults)
}

/** Re-run the embedding pipeline over a source's unembedded documents. */
export async function reembedSource(sourceId: string): Promise<Source | null> {
  return request(
    `/sources/${encodeURIComponent(sourceId)}/embed`,
    { method: 'POST' },
    isSource,
  )
}

export interface ChatPayload {
  message: string
  /**
   * Run a flow rather than the sources named here. The backend starts at
   * `main.flow` unless `flow` names another file.
   */
  useFlow: boolean
  /** Which workflow to run. Its `main.flow` is the entry point. */
  workflow?: string | null
  sourceIds: string[]
  system: string
  history: ChatTurn[]
  topK?: number
}

export type ChatResult = { reply: ChatReply } | { error: string }

/**
 * Ask a question of the chosen sources.
 *
 * Unlike the rest of this module a failure comes back as a message rather
 * than a `null`. Chat fails for reasons the user can act on — sources
 * embedded with different models, nothing embedded yet, the inference API
 * refusing the configured model — and collapsing those into "something went
 * wrong" would leave them with no idea what to change.
 *
 * A question can wait on a cold embedding model, so this gets a longer
 * timeout than `request` allows.
 */
export async function sendChat(payload: ChatPayload): Promise<ChatResult> {
  try {
    const response = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        // A flow runs on the server: the backend compiles it to a LangGraph
        // graph and executes the widgets, so what answers is the canvas itself
        // rather than this app's reading of it.
        message: payload.message,
        use_flow: payload.useFlow,
        workflow: payload.workflow ?? null,
        source_ids: payload.useFlow ? [] : payload.sourceIds,
        system: payload.system,
        top_k: payload.topK,
        // Only the transcript, and only what the backend accepts: markers and
        // citations are ours to render, not part of what the model was told.
        history: payload.history
          .filter((turn) => !turn.error)
          .map((turn) => ({ role: turn.role, content: turn.content })),
      }),
    })

    if (!response.ok) {
      setStatus(response.status >= 500 ? 'offline' : 'online')
      return { error: await errorDetail(response) }
    }

    const data: unknown = await response.json()
    setStatus('online')
    return isChatReply(data)
      ? { reply: data }
      : { error: 'The backend answered with something this app does not understand.' }
  } catch {
    setStatus('offline')
    return { error: 'The backend did not answer. Check that it is running on port 8000.' }
  }
}

/** FastAPI puts the reason in `detail`; fall back to the status line. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail) return detail
  } catch {
    // Not JSON, or an empty body — the status is all there is.
  }
  return `The backend refused the request (${response.status}).`
}

const isOk = (data: unknown): data is { ok: true } =>
  typeof data === 'object' && data !== null && (data as { ok?: unknown }).ok === true

const isFlowFile = (data: unknown): data is FlowFile =>
  typeof data === 'object' && data !== null && typeof (data as FlowFile).name === 'string'

const isFlowFileList = (data: unknown): data is FlowFile[] =>
  Array.isArray(data) && data.every(isFlowFile)

const isFlow = (data: unknown): data is Flow =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as Flow).name === 'string' &&
  typeof (data as Flow).graph === 'object' &&
  Array.isArray((data as Flow).graph?.nodes)





const isWorkflow = (data: unknown): data is Workflow =>
  typeof data === 'object' && data !== null && typeof (data as Workflow).name === 'string'

const isWorkflowList = (data: unknown): data is Workflow[] =>
  Array.isArray(data) && data.every(isWorkflow)

/** A path segment, escaped. Workflow names may contain spaces. */
const seg = (value: string) => encodeURIComponent(value)

// ---- workflows ----------------------------------------------------------

export async function fetchWorkflows(): Promise<Workflow[] | null> {
  return request('/workflows', { method: 'GET' }, isWorkflowList)
}

export async function createWorkflow(name: string): Promise<Workflow | null> {
  return request(
    '/workflows',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
    isWorkflow,
  )
}

export async function renameWorkflow(name: string, next: string): Promise<Workflow | null> {
  return request(
    `/workflows/${seg(name)}/rename`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) },
    isWorkflow,
  )
}

export async function deleteWorkflow(name: string): Promise<boolean> {
  return (await request(`/workflows/${seg(name)}`, { method: 'DELETE' }, isOk)) !== null
}

// ---- flows inside a workflow --------------------------------------------

export async function fetchFlows(workflow: string): Promise<FlowFile[] | null> {
  return request(`/workflows/${seg(workflow)}/flows`, { method: 'GET' }, isFlowFileList)
}

export async function fetchFlow(workflow: string, name: string): Promise<Flow | null> {
  return request(`/workflows/${seg(workflow)}/flows/${seg(name)}`, { method: 'GET' }, isFlow)
}

/**
 * Write a flow, creating the file if it is not there.
 *
 * A PUT because the filename is the identity: saving the same canvas twice
 * writes the same file, and there is nothing to create twice.
 */
export async function saveFlow(
  workflow: string,
  name: string,
  graph: FlowGraph,
): Promise<FlowFile | null> {
  return request(
    `/workflows/${seg(workflow)}/flows/${seg(name)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph) },
    isFlowFile,
  )
}

/** Rename a flow. The backend repoints the Agent widgets that call it. */
export async function renameFlow(
  workflow: string,
  name: string,
  next: string,
): Promise<FlowFile | null> {
  return request(
    `/workflows/${seg(workflow)}/flows/${seg(name)}/rename`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) },
    isFlowFile,
  )
}

export async function deleteFlow(workflow: string, name: string): Promise<boolean> {
  return (
    (await request(`/workflows/${seg(workflow)}/flows/${seg(name)}`, { method: 'DELETE' }, isOk)) !==
    null
  )
}
