-- 0003 upgrade: models become a catalogue sources point at, plus download jobs.

ALTER TABLE downloaded_models RENAME TO embedding_models;

-- A model may now be known without being on disk, so the download columns go
-- nullable. The default has to go too: a registered row must not claim a
-- download time it never had.
ALTER TABLE embedding_models ALTER COLUMN local_path DROP NOT NULL;

ALTER TABLE embedding_models ALTER COLUMN size_bytes DROP NOT NULL;

ALTER TABLE embedding_models ALTER COLUMN downloaded_at DROP NOT NULL;

ALTER TABLE embedding_models ALTER COLUMN downloaded_at DROP DEFAULT;

ALTER TABLE embedding_models
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing sources name models nothing has registered yet; give each one a row
-- before the foreign key starts demanding it.
INSERT INTO embedding_models (id)
SELECT DISTINCT model FROM sources
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sources
    ADD CONSTRAINT sources_model_fkey
    FOREIGN KEY (model) REFERENCES embedding_models (id) ON DELETE RESTRICT;

CREATE INDEX ix_sources_model ON sources (model);

CREATE TYPE download_status AS ENUM ('queued', 'running', 'succeeded', 'failed');

CREATE TABLE download_jobs (
    id               UUID            PRIMARY KEY,
    model_id         VARCHAR(200)    NOT NULL
                                     REFERENCES embedding_models (id) ON DELETE CASCADE,
    status           download_status NOT NULL DEFAULT 'queued',
    -- Bytes on disk so far, against what the Hub says the repo weighs.
    downloaded_bytes BIGINT          NOT NULL DEFAULT 0,
    total_bytes      BIGINT,
    error            TEXT,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);

CREATE INDEX ix_download_jobs_model_id ON download_jobs (model_id);
