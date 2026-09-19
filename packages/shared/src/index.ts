export const DEMO_BOARD_ID = '30000000-0000-0000-0000-000000000001';
export const DEMO_USERS_DATASET_ID = '40000000-0000-0000-0000-000000000001';
export const DEMO_ROLES_DATASET_ID = '40000000-0000-0000-0000-000000000002';

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

export type DatasetKind = 'MANUAL' | 'CSV' | 'SQL' | 'API';
export type DatasetDataType = 'TEXT' | 'INTEGER' | 'BOOLEAN' | 'DATE' | 'UUID';
export type DatasetCellValue = string | number | boolean | null;

export type DatasetMeta = {
  id: string;
  workspaceId: string;
  name: string;
  kind: DatasetKind;
  role?: WorkspaceRole;
};

export type DatasetColumn = {
  id: string;
  name: string;
  dataType: DatasetDataType;
  ordinal: number;
  key?: 'PK' | 'FK';
};

export type DatasetRow = {
  id: string;
  ordinal: number;
  values: Record<string, DatasetCellValue>;
};

export type DatasetSnapshot = DatasetMeta & {
  columns: DatasetColumn[];
  rows: DatasetRow[];
};

export type CreateDatasetInput = {
  name?: string;
  kind?: DatasetKind;
  columns?: Array<Partial<DatasetColumn> & Pick<DatasetColumn, 'name'>>;
  rows?: Array<Partial<DatasetRow> & Pick<DatasetRow, 'values'>>;
};

export type TableNodeData = {
  datasetId: string;
  view?: {
    maxRows?: number;
    labelOverride?: string;
  };
};

export type ObjectBindingType =
  | 'DATASET'
  | 'ROW'
  | 'COLUMN'
  | 'CELL'
  | 'RELATION_VIEW';

export type ObjectBinding = {
  type: ObjectBindingType;
  datasetId: string;
  rowId?: string;
  columnId?: string;
  relationPath?: string[];
};

// Backward-compatible aliases while v0.1 code is being migrated.
export type TableColumn = DatasetColumn;
export type TableRow = DatasetRow;
