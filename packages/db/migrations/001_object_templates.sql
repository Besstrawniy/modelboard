CREATE TABLE IF NOT EXISTS object_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_kind text NOT NULL DEFAULT 'SVG',
  svg text NOT NULL,
  default_width integer NOT NULL DEFAULT 220,
  default_height integer NOT NULL DEFAULT 130,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
