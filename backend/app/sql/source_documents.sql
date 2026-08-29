-- Writes against `source_documents`.

-- name: document_create
-- The id is chosen by the caller: the upload's path on disk is built from it
-- before the row exists.
INSERT INTO source_documents (id, source_id, name, size, kind, status)
VALUES (:id, :source_id, :name, :size, CAST(:kind AS document_kind), 'queued')
RETURNING *;

-- name: document_copy
-- Copy one document onto another source, keeping everything but identity.
-- Merging duplicates the row server-side rather than round-tripping it.
INSERT INTO source_documents (id, source_id, name, size, kind, status, chunks, error)
SELECT :new_id, :new_source_id, name, size, kind, status, chunks, error
FROM source_documents
WHERE id = :id
RETURNING *;

-- name: document_processed
-- Record how a document's pass through the pipeline ended: chunked, embedded
-- and stored, or failed. `chunks` is the passage count on the way through and
-- null on failure, where a number would claim work that did not finish.
UPDATE source_documents
SET status = CAST(:status AS document_status),
    chunks = :chunks,
    error  = :error
WHERE id = :id;

-- name: document_delete
DELETE FROM source_documents
WHERE id = :id;
