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
