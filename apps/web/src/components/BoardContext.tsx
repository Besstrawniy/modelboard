import type {
  BoardDatasetLocation,
  DatasetRelation,
  DatasetRow,
  DatasetSnapshot,
  VisualTemplateRef,
  WorkspaceObjectTemplate,
} from '@modelboard/shared';
import { createContext, useContext } from 'react';

export type CreateRelationViewInput = {
  parentNodeId: string;
  relation: DatasetRelation;
  dataset: DatasetSnapshot;
  row: DatasetRow;
};

export type MaterializeRelatedInput = {
  parentNodeId: string;
  relation: DatasetRelation;
  dataset: DatasetSnapshot;
  rows: DatasetRow[];
  visualTemplate?: VisualTemplateRef;
};

export type BoardActions = {
  showRelationOnCanvas: (relation:DatasetRelation)=>void;
  readOnly: boolean;
  keepAspectRatio: boolean;
  showTransformControls: boolean;
  sessionToken: string;
  boardId: string;
  workspaceId: string;
  workspaceTemplates: WorkspaceObjectTemplate[];
  refreshWorkspaceTemplates: () => Promise<void>;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  materializeRelated: (input: MaterializeRelatedInput) => Promise<number>;
  createRelationView: (input: CreateRelationViewInput) => Promise<boolean>;
  hideMaterializedRelated: (
    parentNodeId: string,
    relationId: string,
  ) => Promise<number>;
  materializedRelatedCount: (
    parentNodeId: string,
    relationId: string,
  ) => number;
  openDatasetSheet: (
    datasetId: string,
    rowId?: string,
  ) => void;
  createBoundRowObject: (
    dataset: DatasetSnapshot,
    row: DatasetRow,
  ) => Promise<string | null>;
  navigateToDatasetLocation: (
    location: BoardDatasetLocation,
    rowId?: string,
  ) => Promise<void>;
};

const BoardActionsContext = createContext<BoardActions>({
  showRelationOnCanvas:()=>undefined,
  readOnly: true,
  keepAspectRatio: false,
  showTransformControls: true,
  sessionToken: '',
  boardId: '',
  workspaceId: '',
  workspaceTemplates: [],
  refreshWorkspaceTemplates: async () => undefined,
  updateNodeData: () => undefined,
  materializeRelated: async () => 0,
  createRelationView: async () => false,
  hideMaterializedRelated: async () => 0,
  materializedRelatedCount: () => 0,
  openDatasetSheet: () => undefined,
  createBoundRowObject: async () => null,
  navigateToDatasetLocation: async () => undefined,
});

export const BoardActionsProvider = BoardActionsContext.Provider;
export const useBoardActions = () => useContext(BoardActionsContext);
