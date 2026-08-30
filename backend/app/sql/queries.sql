-- Every read in the application. Reads cannot change a table's invariants, so
-- they are grouped by what a caller wants rather than by what they touch; the
-- writes live one file per table, beside the constraints they have to respect.

-- name: health_check
-- Cheapest round trip that proves the connection works.
SELECT 1;

-- name: sources_all
SELECT *
FROM sources
ORDER BY created_at DESC;

-- name: source_by_id
SELECT *
FROM sources
WHERE id = :id;

-- name: sources_by_ids
SELECT *
FROM sources
WHERE id = ANY(:ids);

-- name: document_by_id
SELECT *
FROM source_documents
WHERE id = :id;

-- name: documents_for_sources
-- Every document belonging to the given sources, in one pass. Callers group
-- these onto their source by source_id.
SELECT *
FROM source_documents
WHERE source_id = ANY(:source_ids)
ORDER BY added_at, id;

-- name: chunks_for_document
-- A document's passages, in the order they appear in it.
SELECT *
FROM document_chunks
WHERE document_id = :document_id
ORDER BY ordinal;

-- name: chunks_for_model
-- Every embedded passage belonging to a source that uses this model. Vectors
-- are only comparable within one model — a different model puts the same
-- sentence somewhere else, in a space of its own dimensions — so the model is
-- the boundary a search runs inside.
SELECT c.id, c.document_id, c.ordinal, c.text, c.tokens, c.pages, c.embedding,
       d.name AS document_name, d.source_id
FROM document_chunks c
JOIN source_documents d ON d.id = c.document_id
JOIN sources s ON s.id = d.source_id
WHERE s.model = :model
  AND c.embedding IS NOT NULL;

-- name: chunks_for_sources
-- Every embedded passage in the given sources. A chat is scoped to the
-- sources the user picked rather than to every source sharing a model, so
-- asking one knowledge base a question cannot pull an answer out of another.
SELECT c.id, c.document_id, c.ordinal, c.text, c.tokens, c.pages, c.embedding,
       d.name AS document_name, d.source_id
FROM document_chunks c
JOIN source_documents d ON d.id = c.document_id
WHERE d.source_id = ANY(:source_ids)
  AND c.embedding IS NOT NULL;

-- name: documents_unembedded
-- A source's documents that have no usable vectors: never run, interrupted
-- part way, or failed. What a re-run of the pipeline picks up.
SELECT *
FROM source_documents
WHERE source_id = :source_id
  AND status <> 'ready'
ORDER BY added_at, id;

-- name: models_downloaded
-- Models with a finished download. The catalogue also holds models that were
-- only ever named, hence the filter.
SELECT *
FROM embedding_models
WHERE downloaded_at IS NOT NULL
ORDER BY downloaded_at DESC;

-- name: jobs_recent
SELECT *
FROM download_jobs
ORDER BY created_at DESC
LIMIT :limit;

-- name: job_by_id
SELECT *
FROM download_jobs
WHERE id = :id;

-- name: job_active_for_model
-- The unfinished job for a model, if a download is already going.
SELECT *
FROM download_jobs
WHERE model_id = :model_id
  AND status IN ('queued', 'running')
ORDER BY created_at DESC
LIMIT 1;
