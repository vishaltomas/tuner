-- The unfinished job for a model, if a download is already going.
SELECT *
FROM download_jobs
WHERE model_id = :model_id
  AND status IN ('queued', 'running')
ORDER BY created_at DESC
LIMIT 1;
