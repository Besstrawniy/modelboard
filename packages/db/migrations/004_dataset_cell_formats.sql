CREATE TABLE IF NOT EXISTS dataset_cell_formats (
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
  format jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, row_id, column_id)
);
