-- 0004 downgrade. Chunks are derived from the uploaded files, so dropping them
-- loses nothing that cannot be produced again by chunking the documents.

DROP TABLE document_chunks;
