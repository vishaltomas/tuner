-- Writes against `download_jobs`. A download outlives the request that asked
-- for it, so its progress and outcome are written here rather than held in
-- memory; every statement below is what the worker reports with.

-- name: job_create
INSERT INTO download_jobs (id, model_id, status)
VALUES (:id, :model_id, 'queued')
RETURNING *;

-- name: job_start
UPDATE download_jobs
SET status      = 'running',
    total_bytes = :total_bytes,
    updated_at  = now()
WHERE id = :id;

-- name: job_progress
-- Written every tick by the poller watching the snapshot directory.
UPDATE download_jobs
SET downloaded_bytes = :downloaded_bytes,
    updated_at       = now()
WHERE id = :id;

-- name: job_succeeded
UPDATE download_jobs
SET status           = 'succeeded',
    downloaded_bytes = :downloaded_bytes,
    updated_at       = now(),
    finished_at      = now()
WHERE id = :id;

-- name: job_failed
UPDATE download_jobs
SET status      = 'failed',
    error       = :error,
    updated_at  = now(),
    finished_at = now()
WHERE id = :id;
