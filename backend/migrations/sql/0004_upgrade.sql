-- 0004 upgrade: the passages a document is split into, ahead of embedding.

CREATE TABLE document_chunks (
    id          UUID        PRIMARY KEY,
    document_id UUID        NOT NULL
                            REFERENCES source_documents (id) ON DELETE CASCADE,
    -- Position within the document. Named `ordinal` because `index` reads as
    -- the DDL keyword everywhere it is written unquoted.
    ordinal     INTEGER     NOT NULL,
    text        TEXT        NOT NULL,
    -- Length measured with the source's own tokenizer, so nothing downstream
    -- re-encodes the passage to find out whether it fits the model.
    tokens      INTEGER     NOT NULL,
    -- Pages the passage drew on, for citations. Null for a text file, which
    -- has no pages, and for a PDF element that carried no page number.
    pages       INTEGER[],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Chunking a document again replaces its passages, so a position can only
    -- appear once: a rerun that half-finished cannot leave two of the same.
    CONSTRAINT uq_document_chunks_document_id_ordinal UNIQUE (document_id, ordinal)
);

CREATE INDEX ix_document_chunks_document_id ON document_chunks (document_id);
