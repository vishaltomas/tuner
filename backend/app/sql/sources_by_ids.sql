SELECT *
FROM sources
WHERE id = ANY(:ids);
