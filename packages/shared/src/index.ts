export const DEMO_BOARD_ID = '30000000-0000-0000-0000-000000000001';

export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export const canEditBoard = (role: WorkspaceRole) =>
  role === 'OWNER' || role === 'EDITOR';

export const canComment = (role: WorkspaceRole) =>
  role === 'OWNER' || role === 'EDITOR' || role === 'COMMENTER';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type BoardMeta = {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

export type TableColumn = {
  id: string;
  name: string;
  dataType: 'TEXT' | 'INTEGER' | 'BOOLEAN' | 'DATE' | 'UUID';
  key?: 'PK' | 'FK';
};

export type TableRow = {
  id: string;
  values: Record<string, string | number | boolean | null>;
};

export type TableNodeData = {
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
};
