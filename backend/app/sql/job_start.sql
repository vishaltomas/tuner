UPDATE download_jobs
SET status      = 'running',
    total_bytes = :total_bytes,
    updated_at  = now()
WHERE id = :id;
