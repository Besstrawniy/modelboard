import { useEffect, useState } from 'react';
import {
  DEMO_BOARD_ID,
  type AuthSession,
  type BoardMeta,
} from '@modelboard/shared';
import { api, type DevUser } from './lib/api';
import { CollaborativeBoard } from './components/CollaborativeBoard';

const LAST_BOARD_KEY = 'modelboard:last-board';

export default function App() {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [meta, setMeta] = useState<BoardMeta | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.devUsers()
      .then(setUsers)
      .catch((err) => setError(String(err)));
  }, []);

  const login = async (userId: string) => {
    try {
      setError('');
      const next = await api.devLogin(userId);
      const demoBoard = await api.board(DEMO_BOARD_ID, next.token);
      const workspaceBoards = await api.boards(
        demoBoard.workspaceId,
        next.token,
      );

      const lastBoardId = localStorage.getItem(LAST_BOARD_KEY);
      const preferred =
        workspaceBoards.find((board) => board.id === lastBoardId) ??
        workspaceBoards.find((board) => board.id === DEMO_BOARD_ID) ??
        workspaceBoards[0] ??
        demoBoard;

      const selected =
        preferred.id === demoBoard.id
          ? demoBoard
          : await api.board(preferred.id, next.token);

      setSession(next);
      setBoards(workspaceBoards.length ? workspaceBoards : [demoBoard]);
      setMeta(selected);
      localStorage.setItem(LAST_BOARD_KEY, selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const switchBoard = async (boardId: string) => {
    if (!session || boardId === meta?.id) return;

    try {
      setError('');
      const board = await api.board(boardId, session.token);
      setMeta(board);
      localStorage.setItem(LAST_BOARD_KEY, board.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createBoard = async (name: string) => {
    if (!session || !meta) return;

    const board = await api.createBoard(
      meta.workspaceId,
      session.token,
      name,
    );

    setBoards((current) => [...current, board]);
    setMeta(board);
    localStorage.setItem(LAST_BOARD_KEY, board.id);
  };

  if (!session || !meta) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand brand--large">
            <span className="brand-mark">M</span>
            ModelBoard
          </div>
          <h1>Collaborative canvas for data + diagrams</h1>
          <p>Choose a seeded identity to test the v0.1 permission model.</p>
          <div className="demo-users">
            {users.map((user) => (
              <button key={user.id} onClick={() => login(user.id)}>
                <span>{user.displayName}</span>
                <small>{user.role}</small>
              </button>
            ))}
          </div>
          {error && <pre className="error-box">{error}</pre>}
          <p className="muted small">
            Open Owner and Editor in separate windows to verify realtime
            editing. Commenter can add comments but cannot mutate the board;
            Viewer is fully read-only.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <CollaborativeBoard
        meta={meta}
        session={session}
        boards={boards}
        onSwitchBoard={switchBoard}
        onCreateBoard={createBoard}
      />
      {error && (
        <div className="global-error-toast">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}
    </>
  );
}
