-- Adding a document does not touch its source, and the list view sorts on this.
UPDATE sources
SET updated_at = now()
WHERE id = :id;
