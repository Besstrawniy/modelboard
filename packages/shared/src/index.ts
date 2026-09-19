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

export type BoardDatasetLocation = {
  boardId: string;
  boardName: string;
  objectId: string;
  objectType: string;
  datasetId: string;
  rowId?: string | null;
  columnId?: string | null;
  properties?: Record<string, unknown>;
};

export type WorkspaceSearchResult =
  | {
      kind: 'BOARD';
      id: string;
      title: string;
      subtitle: string;
      boardId: string;
    }
  | {
      kind: 'DATASET';
      id: string;
      title: string;
      subtitle: string;
      datasetId: string;
    }
  | {
      kind: 'OBJECT';
      id: string;
      title: string;
      subtitle: string;
      boardId: string;
      boardName: string;
      objectId: string;
      objectType: string;
      datasetId?: string | null;
      rowId?: string | null;
      columnId?: string | null;
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

export type DatasetFormula = {
  rowId: string;
  columnId: string;
  expression: string;
};

export type DatasetSnapshot = DatasetMeta & {
  columns: DatasetColumn[];
  rows: DatasetRow[];
  formulas: DatasetFormula[];
};

export type ConvertDatasetColumnInput = {
  dataType: DatasetDataType;
  values: Record<string, DatasetCellValue>;
};

export type ConvertDatasetColumnResult = {
  column: DatasetColumn;
  values: Record<string, DatasetCellValue>;
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

export type DatasetRelationType =
  | 'REFERENCE'
  | 'FOREIGN_KEY'
  | 'DEPENDENCY'
  | 'MAP'
  | 'FLOW';

export type DatasetRelationCardinality =
  | '1:1'
  | '1:N'
  | 'N:1'
  | 'N:M';

export type DatasetRelation = {
  id: string;
  workspaceId: string;
  sourceDatasetId: string;
  sourceColumnId: string;
  targetDatasetId: string;
  targetColumnId: string;
  relationType: DatasetRelationType;
  cardinality?: DatasetRelationCardinality | null;
};

export type CreateDatasetRelationInput = Omit<
  DatasetRelation,
  'id' | 'workspaceId'
>;

export type ObjectBindingType =
  | 'DATASET'
  | 'ROW'
  | 'COLUMN'
  | 'CELL'
  | 'RELATION_VIEW';

export type ObjectBindingPresentation = {
  titleColumnId?: string;
  subtitleColumnId?: string;
  [key: string]: unknown;
};

export type ObjectBinding = {
  type: ObjectBindingType;
  datasetId: string;
  rowId?: string;
  columnId?: string;
  relationPath?: string[];
  presentation?: ObjectBindingPresentation;
};

export type ObjectBindingRecord = ObjectBinding & {
  id: string;
  boardId: string;
  boardObjectId: string;
};

export type UpsertObjectBindingInput = ObjectBinding;

export type ShapeNodeData = {
  text?: string;
  binding?: ObjectBindingRecord | null;
};

export type DeviceKind =
  | 'SERVER'
  | 'VM'
  | 'SWITCH'
  | 'ROUTER'
  | 'FIREWALL'
  | 'DATABASE'
  | 'CLOUD';

export type WorkspaceObjectTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  kind: 'SVG';
  svg: string;
  defaultWidth: number;
  defaultHeight: number;
  properties?: Record<string, unknown>;
  createdAt?: string;
};

export type CreateWorkspaceObjectTemplateInput = {
  name: string;
  svg: string;
  defaultWidth?: number;
  defaultHeight?: number;
  properties?: Record<string, unknown>;
};

export type VisualTemplateRef =
  | { source: 'BUILTIN'; deviceKind: DeviceKind }
  | { source: 'WORKSPACE'; templateId: string };

export type DeviceNodeData = {
  deviceKind: DeviceKind;
  label?: string;
  binding?: ObjectBindingRecord | null;
  generatedFrom?: {
    parentNodeId: string;
    relationId: string;
    rowId: string;
  };
};

export type TemplateNodeData = {
  templateId: string;
  label?: string;
  binding?: ObjectBindingRecord | null;
  generatedFrom?: {
    parentNodeId: string;
    relationId: string;
    rowId: string;
  };
};

export type RelationViewNodeData = {
  relationId: string;
  parentNodeId?: string;
  binding: ObjectBindingRecord;
};

export type FreehandPoint = {
  x: number;
  y: number;
};

export type FreehandStroke = {
  id: string;
  points: FreehandPoint[];
  width: number;
  color: string;
  createdBy: string;
};

// Backward-compatible aliases while v0.1 code is being migrated.
export type TableColumn = DatasetColumn;
export type TableRow = DatasetRow;
