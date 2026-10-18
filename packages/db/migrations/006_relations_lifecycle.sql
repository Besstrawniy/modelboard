ALTER TABLE datasets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE dataset_relations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS active_datasets_workspace ON datasets(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS active_relations_workspace ON dataset_relations(workspace_id) WHERE deleted_at IS NULL;
