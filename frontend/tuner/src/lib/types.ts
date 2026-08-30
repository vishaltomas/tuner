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
  /** Cosine similarity to the question, in [-1, 1]. */
  score: number
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
