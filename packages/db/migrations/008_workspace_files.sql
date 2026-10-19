CREATE TABLE IF NOT EXISTS workspace_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL,
 mime text NOT NULL,
 data bytea NOT NULL,
 size integer NOT NULL CHECK(size > 0 AND size <= 3145728),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_files_workspace_idx ON workspace_files(workspace_id);
