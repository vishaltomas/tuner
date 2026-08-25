-- source_documents cascades from here; the files are removed by the caller.
DELETE FROM sources
WHERE id = :id;
