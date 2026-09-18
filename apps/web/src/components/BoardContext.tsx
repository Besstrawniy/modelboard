import { createContext, useContext } from 'react';

export type BoardActions = {
  readOnly: boolean;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
};

const BoardActionsContext = createContext<BoardActions>({
  readOnly: true,
  updateNodeData: () => undefined,
});

export const BoardActionsProvider = BoardActionsContext.Provider;
export const useBoardActions = () => useContext(BoardActionsContext);
