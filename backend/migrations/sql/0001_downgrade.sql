-- 0001 downgrade.
-- The index goes with its table; the enum types do not.

DROP TABLE source_documents;

DROP TABLE sources;

DROP TYPE document_status;

DROP TYPE document_kind;
