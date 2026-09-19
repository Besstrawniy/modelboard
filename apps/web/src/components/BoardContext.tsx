import type {
  DatasetRelation,
  DatasetRow,
  DatasetSnapshot,
} from '@modelboard/shared';
import { createContext, useContext } from 'react';

export type MaterializeRelatedInput = {
  parentNodeId: string;
  relation: DatasetRelation;
  dataset: DatasetSnapshot;
  rows: DatasetRow[];
};

export type BoardActions = {
  readOnly: boolean;
  sessionToken: string;
  boardId: string;
  workspaceId: string;
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
};

const BoardActionsContext = createContext<BoardActions>({
  readOnly: true,
  sessionToken: '',
  boardId: '',
  workspaceId: '',
  updateNodeData: () => undefined,
  materializeRelated: async () => 0,
  hideMaterializedRelated: () => 0,
  materializedRelatedCount: () => 0,
});

export const BoardActionsProvider = BoardActionsContext.Provider;
export const useBoardActions = () => useContext(BoardActionsContext);
