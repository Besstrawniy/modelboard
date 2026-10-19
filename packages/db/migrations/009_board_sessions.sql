CREATE TABLE IF NOT EXISTS board_sessions (
  board_id uuid PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
