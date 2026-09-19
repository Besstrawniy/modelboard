import type {
  DatasetRelation,
  DatasetRow,
  DatasetSnapshot,
  VisualTemplateRef,
  WorkspaceObjectTemplate,
} from '@modelboard/shared';
import { createContext, useContext } from 'react';

export type MaterializeRelatedInput = {
  parentNodeId: string;
  relation: DatasetRelation;
  dataset: DatasetSnapshot;
  rows: DatasetRow[];
  visualTemplate?: VisualTemplateRef;
};

export type BoardActions = {
  readOnly: boolean;
  sessionToken: string;
  boardId: string;
  workspaceId: string;
  workspaceTemplates: WorkspaceObjectTemplate[];
  refreshWorkspaceTemplates: () => Promise<void>;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  materializeRelated: (input: MaterializeRelatedInput) => Promise<number>;
  hideMaterializedRelated: (
    parentNodeId: string,
    relationId: string,
  ) => number;
  materializedRelatedCount: (
    parentNodeId: string,
    relationId: string,
  ) => number;
  openDatasetSheet: (
    datasetId: string,
    rowId?: string,
  ) => void;
};

const BoardActionsContext = createContext<BoardActions>({
  readOnly: true,
  sessionToken: '',
  boardId: '',
  workspaceId: '',
  workspaceTemplates: [],
  refreshWorkspaceTemplates: async () => undefined,
  updateNodeData: () => undefined,
  materializeRelated: async () => 0,
  hideMaterializedRelated: () => 0,
  materializedRelatedCount: () => 0,
  openDatasetSheet: () => undefined,
});

export const BoardActionsProvider = BoardActionsContext.Provider;
export const useBoardActions = () => useContext(BoardActionsContext);
