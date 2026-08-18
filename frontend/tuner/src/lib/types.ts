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
