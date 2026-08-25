SELECT *
FROM download_jobs
ORDER BY created_at DESC
LIMIT :limit;
