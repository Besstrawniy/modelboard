CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('OWNER', 'EDITOR', 'COMMENTER', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE object_binding_type AS ENUM ('DATASET', 'ROW', 'COLUMN', 'CELL', 'RELATION_VIEW');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role workspace_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collab_documents (
  document_name text PRIMARY KEY,
  state bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'MANUAL',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dataset_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name text NOT NULL,
  data_type text NOT NULL DEFAULT 'TEXT',
  ordinal integer NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (dataset_id, ordinal)
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (dataset_id, ordinal)
);

CREATE TABLE IF NOT EXISTS dataset_formulas (
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
  expression text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, row_id, column_id)
);

CREATE TABLE IF NOT EXISTS dataset_cell_formats (
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES dataset_rows(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
  format jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, row_id, column_id)
);

CREATE TABLE IF NOT EXISTS dataset_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  source_column_id uuid NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
  target_dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  target_column_id uuid NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'REFERENCE',
  cardinality text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS object_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  board_object_id text NOT NULL,
  binding_type object_binding_type NOT NULL,
  dataset_id uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_id uuid REFERENCES dataset_rows(id) ON DELETE SET NULL,
  column_id uuid REFERENCES dataset_columns(id) ON DELETE SET NULL,
  relation_path jsonb,
  presentation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, board_object_id)
);

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

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  object_id text,
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  x double precision,
  y double precision,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (id, email, display_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'owner@example.local', 'Owner'),
  ('10000000-0000-0000-0000-000000000002', 'editor@example.local', 'Editor'),
  ('10000000-0000-0000-0000-000000000003', 'commenter@example.local', 'Commenter'),
  ('10000000-0000-0000-0000-000000000004', 'viewer@example.local', 'Viewer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, name, created_by)
VALUES ('20000000-0000-0000-0000-000000000001', 'ModelBoard Demo', '10000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'OWNER'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'EDITOR'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'COMMENTER'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'VIEWER')
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO boards (id, workspace_id, name, created_by)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Architecture + Data',
  '10000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO datasets (id, workspace_id, name, kind, created_by) VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'users',
    'MANUAL',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'roles',
    'MANUAL',
    '10000000-0000-0000-0000-000000000001'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO dataset_columns (id, dataset_id, name, data_type, ordinal, properties) VALUES
  (
    '41000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'id',
    'INTEGER',
    0,
    '{"key":"PK"}'::jsonb
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    'name',
    'TEXT',
    1,
    '{}'::jsonb
  ),
  (
    '41000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000001',
    'role_id',
    'INTEGER',
    2,
    '{"key":"FK"}'::jsonb
  ),
  (
    '42000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'id',
    'INTEGER',
    0,
    '{"key":"PK"}'::jsonb
  ),
  (
    '42000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    'name',
    'TEXT',
    1,
    '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO dataset_rows (id, dataset_id, ordinal, values) VALUES
  (
    '41100000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    0,
    '{"41000000-0000-0000-0000-000000000001":1,"41000000-0000-0000-0000-000000000002":"Alex","41000000-0000-0000-0000-000000000003":1}'::jsonb
  ),
  (
    '41100000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    1,
    '{"41000000-0000-0000-0000-000000000001":2,"41000000-0000-0000-0000-000000000002":"Ivan","41000000-0000-0000-0000-000000000003":2}'::jsonb
  ),
  (
    '42100000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    0,
    '{"42000000-0000-0000-0000-000000000001":1,"42000000-0000-0000-0000-000000000002":"Admin"}'::jsonb
  ),
  (
    '42100000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    1,
    '{"42000000-0000-0000-0000-000000000001":2,"42000000-0000-0000-000000000002":"User"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO dataset_relations (
  id,
  workspace_id,
  source_dataset_id,
  source_column_id,
  target_dataset_id,
  target_column_id,
  relation_type,
  cardinality
)
VALUES (
  '43000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000002',
  '42000000-0000-0000-0000-000000000001',
  'FOREIGN_KEY',
  'N:1'
)
ON CONFLICT (id) DO NOTHING;
