-- 0005 upgrade: the vector each passage embeds to.

-- REAL[] rather than pgvector's `vector`: the extension is not installed on
-- this cluster, and an array needs none. The cost is that similarity is
-- computed in the application instead of by the database, and no index can
-- serve it — every candidate is scanned. Moving to `vector` later is a type
-- change on this column and a rewrite of the search, nothing else.
ALTER TABLE document_chunks ADD COLUMN embedding REAL[];
