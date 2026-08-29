-- 0005 downgrade. Vectors are derived from the passages and the model, so
-- dropping them loses nothing that embedding again cannot produce.

ALTER TABLE document_chunks DROP COLUMN embedding;
