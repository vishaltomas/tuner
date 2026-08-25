-- Written every tick by the poller watching the snapshot directory.
UPDATE download_jobs
SET downloaded_bytes = :downloaded_bytes,
    updated_at       = now()
WHERE id = :id;
