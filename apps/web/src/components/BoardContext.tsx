import { createContext, useContext } from 'react';

export type BoardActions = {
  readOnly: boolean;
  sessionToken: string;
  boardId: string;
  workspaceId: string;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
};

const BoardActionsContext = createContext<BoardActions>({
  readOnly: true,
  sessionToken: '',
  boardId: '',
  workspaceId: '',
  updateNodeData: () => undefined,
});

export const BoardActionsProvider = BoardActionsContext.Provider;
export const useBoardActions = () => useContext(BoardActionsContext);
