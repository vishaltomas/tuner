-- 0003 downgrade.
-- Rows registered without a download cannot satisfy the old NOT NULLs, so they
-- go; anything actually downloaded survives.

DROP TABLE download_jobs;

DROP TYPE download_status;

DROP INDEX ix_sources_model;

ALTER TABLE sources DROP CONSTRAINT sources_model_fkey;

DELETE FROM embedding_models WHERE local_path IS NULL;

ALTER TABLE embedding_models DROP COLUMN created_at;

ALTER TABLE embedding_models ALTER COLUMN downloaded_at SET DEFAULT now();

ALTER TABLE embedding_models ALTER COLUMN downloaded_at SET NOT NULL;

ALTER TABLE embedding_models ALTER COLUMN size_bytes SET NOT NULL;

ALTER TABLE embedding_models ALTER COLUMN local_path SET NOT NULL;

ALTER TABLE embedding_models RENAME TO downloaded_models;
