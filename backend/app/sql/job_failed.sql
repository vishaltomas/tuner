UPDATE download_jobs
SET status      = 'failed',
    error       = :error,
    updated_at  = now(),
    finished_at = now()
WHERE id = :id;
