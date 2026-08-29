-- Writes against `document_chunks`.

-- name: chunk_create
-- One passage. Executed with a list of parameter sets, so it returns nothing:
-- RETURNING is not answered per row when the driver batches the insert.
INSERT INTO document_chunks (id, document_id, ordinal, text, tokens, pages, embedding)
VALUES (:id, :document_id, :ordinal, :text, :tokens, :pages, :embedding);

-- name: chunks_delete_for_document
-- Clear a document's passages before writing them again. Chunking is not
-- incremental: a rerun replaces what the last one produced.
DELETE FROM document_chunks
WHERE document_id = :document_id;
