INSERT INTO sources (id, name, model, merged_from)
VALUES (gen_random_uuid(), :name, :model, :merged_from)
RETURNING *;
