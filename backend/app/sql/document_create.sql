-- The id is chosen by the caller: the upload's path on disk is built from it
-- before the row exists.
INSERT INTO source_documents (id, source_id, name, size, kind, status)
VALUES (:id, :source_id, :name, :size, CAST(:kind AS document_kind), 'queued')
RETURNING *;
