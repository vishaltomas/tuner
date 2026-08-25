-- Every document belonging to the given sources, in one pass. Callers group
-- these onto their source by source_id.
SELECT *
FROM source_documents
WHERE source_id = ANY(:source_ids)
ORDER BY added_at, id;
