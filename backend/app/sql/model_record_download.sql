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
