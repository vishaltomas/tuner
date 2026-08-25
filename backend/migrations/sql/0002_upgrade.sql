-- 0002 upgrade: models fetched to local disk.

CREATE TABLE downloaded_models (
    -- The Hugging Face id, e.g. 'BAAI/bge-small-en-v1.5'. Natural key, so a
    -- repeated download updates this row instead of adding another.
    id            VARCHAR(200) PRIMARY KEY,
    author        VARCHAR(200),
    downloads     BIGINT,
    likes         INTEGER,
    pipeline_tag  VARCHAR(100),
    library_name  VARCHAR(100),
    tags          TEXT[],
    -- Absolute path to the snapshot, and what it costs on disk.
    local_path    TEXT         NOT NULL,
    size_bytes    BIGINT       NOT NULL,
    downloaded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
