-- Writes against `sources`.

-- name: source_create
INSERT INTO sources (id, name, description, model)
VALUES (gen_random_uuid(), :name, :description, :model)
RETURNING *;

-- name: source_create_merged
INSERT INTO sources (id, name, model, merged_from)
VALUES (gen_random_uuid(), :name, :model, :merged_from)
RETURNING *;

-- name: source_touch
-- Adding a document does not touch its source, and the list view sorts on this.
UPDATE sources
SET updated_at = now()
WHERE id = :id;

-- name: source_delete
-- source_documents cascades from here; the files are removed by the caller.
DELETE FROM sources
WHERE id = :id;
