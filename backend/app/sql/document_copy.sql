-- Copy one document onto another source, keeping everything but identity.
-- Merging duplicates the row server-side rather than round-tripping it.
INSERT INTO source_documents (id, source_id, name, size, kind, status, chunks, error)
SELECT :new_id, :new_source_id, name, size, kind, status, chunks, error
FROM source_documents
WHERE id = :id
RETURNING *;
