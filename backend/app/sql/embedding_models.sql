-- Writes against `embedding_models`, the catalogue sources point at.

-- name: model_register
-- Claim a catalogue row for a model id. sources.model is a foreign key, so the
-- row has to exist before anything can point at it.
INSERT INTO embedding_models (id)
VALUES (:id)
ON CONFLICT (id) DO NOTHING;

-- name: model_record_download
-- Record what a finished download produced.
UPDATE embedding_models
SET author        = :author,
    downloads     = :downloads,
    likes         = :likes,
    pipeline_tag  = :pipeline_tag,
    library_name  = :library_name,
    tags          = :tags,
    local_path    = :local_path,
    size_bytes    = :size_bytes,
    downloaded_at = now()
WHERE id = :id;
