ALTER TABLE dataset_relations ALTER COLUMN source_column_id DROP NOT NULL;
ALTER TABLE dataset_relations ALTER COLUMN target_column_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS dataset_relation_links (
 relation_id uuid NOT NULL REFERENCES dataset_relations(id) ON DELETE CASCADE,
 source_row_id uuid NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
 target_row_id uuid NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
 PRIMARY KEY(relation_id,source_row_id,target_row_id)
);
