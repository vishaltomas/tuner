INSERT INTO download_jobs (id, model_id, status)
VALUES (:id, :model_id, 'queued')
RETURNING *;
