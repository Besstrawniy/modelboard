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
  const [authMode, setAuthMode] = useState<'demo'|'password'|null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfiguration()
      .then(async config => {
        setAuthMode(config.mode);
        if (config.mode === 'demo') setUsers(await api.devUsers());
      })
      .catch((err) => setError(String(err)));
  }, []);

  const login = async (userId?: string) => {
    if (busy || !authMode) return;
    setBusy(true);
    try {
      setError('');
      const next = authMode === 'password'
        ? await api.login(email, password)
        : await api.devLogin(userId!);
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

      setPassword('');
      setSession(next);
      setBoards(workspaceBoards.length ? workspaceBoards : [demoBoard]);
      setMeta(selected);
      localStorage.setItem(LAST_BOARD_KEY, selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const switchBoard = async (boardId: string) => {
    if (!session || boardId === meta?.id) return;

    try {
      setError('');
      const board = await api.board(boardId, session.token);
      setBoards(current=>current.some(item=>item.id===board.id)?current:[...current,board]);
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

  const renameBoard = async (boardId: string, name: string) => {
    if (!session) return;

    const board = await api.renameBoard(
      boardId,
      session.token,
      name,
    );

    setBoards((current) =>
      current.map((item) =>
        item.id === boardId ? board : item,
      ),
    );

    if (meta?.id === boardId) {
      setMeta(board);
    }
  };

  const deleteBoard = async (boardId: string) => {
    if (!session) return;

    await api.deleteBoard(boardId, session.token);

    const remaining = boards.filter(
      (board) => board.id !== boardId,
    );
    setBoards(remaining);

    if (meta?.id === boardId && remaining[0]) {
      const next = await api.board(
        remaining[0].id,
        session.token,
      );
      setMeta(next);
      localStorage.setItem(LAST_BOARD_KEY, next.id);
    }
  };

  if (!session || !meta) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand brand--large">
            <span className="brand-mark">M</span>
            ModelBoard
          </div>
          <h1>Доска для совместной работы</h1>
          {authMode === 'password' && (
            <>
              <p>Войдите в свою учётную запись.</p>
              <form className="login-form" onSubmit={event => { event.preventDefault(); void login(); }}>
                <label htmlFor="login-email">Email</label>
                <input id="login-email" type="email" autoComplete="username" required maxLength={254}
                  value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
                <label htmlFor="login-password">Пароль</label>
                <input id="login-password" type="password" autoComplete="current-password" required maxLength={1024}
                  value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
                <button type="submit" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
              </form>
              <p className="muted small">Данные для входа предоставляет администратор.</p>
            </>
          )}
          {authMode === 'demo' && (
            <>
              <p>Демонстрационный режим: выберите пользователя.</p>
              <div className="demo-users">
                {users.map(user => (
                  <button key={user.id} disabled={busy} onClick={() => void login(user.id)}>
                    <span>{user.displayName}</span>
                    <small>{user.role}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {!authMode && !error && <p role="status">Загрузка…</p>}
          {error && <p className="error-box" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <>
      <CollaborativeBoard
        key={`${meta.id}:${session.user.id}`}
        meta={meta}
        session={session}
        boards={boards}
        onSwitchBoard={switchBoard}
        onCreateBoard={createBoard}
        onRenameBoard={renameBoard}
        onDeleteBoard={deleteBoard}
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
