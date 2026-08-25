INSERT INTO sources (id, name, description, model)
VALUES (gen_random_uuid(), :name, :description, :model)
RETURNING *;
