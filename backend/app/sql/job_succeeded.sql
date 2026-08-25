UPDATE download_jobs
SET status           = 'succeeded',
    downloaded_bytes = :downloaded_bytes,
    updated_at       = now(),
    finished_at      = now()
WHERE id = :id;
