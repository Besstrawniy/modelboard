CREATE TABLE IF NOT EXISTS dataset_sheet_settings (
  dataset_id uuid PRIMARY KEY REFERENCES datasets(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dataset_columns DROP CONSTRAINT IF EXISTS dataset_columns_dataset_id_ordinal_key;
ALTER TABLE dataset_columns ADD CONSTRAINT dataset_columns_dataset_id_ordinal_key UNIQUE (dataset_id, ordinal) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE dataset_rows DROP CONSTRAINT IF EXISTS dataset_rows_dataset_id_ordinal_key;
ALTER TABLE dataset_rows ADD CONSTRAINT dataset_rows_dataset_id_ordinal_key UNIQUE (dataset_id, ordinal) DEFERRABLE INITIALLY DEFERRED;
