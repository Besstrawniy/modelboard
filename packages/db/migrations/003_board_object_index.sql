CREATE TABLE IF NOT EXISTS board_object_index (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  object_id text NOT NULL,
  object_type text NOT NULL,
  dataset_id uuid REFERENCES datasets(id) ON DELETE CASCADE,
  row_id uuid REFERENCES dataset_rows(id) ON DELETE SET NULL,
  column_id uuid REFERENCES dataset_columns(id) ON DELETE SET NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, object_id)
);

CREATE INDEX IF NOT EXISTS board_object_index_dataset_idx
  ON board_object_index(dataset_id);

CREATE INDEX IF NOT EXISTS board_object_index_row_idx
  ON board_object_index(row_id);
