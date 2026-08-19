-- 0001 upgrade: sources and their documents.

CREATE TYPE document_kind AS ENUM ('pdf', 'txt');

CREATE TYPE document_status AS ENUM ('queued', 'embedding', 'ready', 'failed');

-- One upload session: a named set of documents sharing an embedding model.
CREATE TABLE sources (
    id          UUID         PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    -- Hugging Face id of the model used for every document in this source.
    model       VARCHAR(200) NOT NULL,
    -- Names of the sources this one was merged from, if any.
    merged_from TEXT[],
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- A single uploaded file and how far its embedding run got.
CREATE TABLE source_documents (
    id        UUID            PRIMARY KEY,
    source_id UUID            NOT NULL
                              REFERENCES sources (id) ON DELETE CASCADE,
    name      VARCHAR(500)    NOT NULL,
    -- Size in bytes; BIGINT because a 2GB corpus overflows int4.
    size      BIGINT          NOT NULL,
    kind      document_kind   NOT NULL,
    status    document_status NOT NULL,
    -- Number of vectors written for this document, once embedded.
    chunks    INTEGER,
    error     TEXT,
    added_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX ix_source_documents_source_id ON source_documents (source_id);
