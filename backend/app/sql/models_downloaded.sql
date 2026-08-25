-- Models with a finished download. The catalogue also holds models that were
-- only ever named, hence the filter.
SELECT *
FROM embedding_models
WHERE downloaded_at IS NOT NULL
ORDER BY downloaded_at DESC;
