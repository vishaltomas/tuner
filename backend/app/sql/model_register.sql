-- Claim a catalogue row for a model id. sources.model is a foreign key, so the
-- row has to exist before anything can point at it.
INSERT INTO embedding_models (id)
VALUES (:id)
ON CONFLICT (id) DO NOTHING;
