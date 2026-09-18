import { useEffect, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { api } from '../lib/api';
import type { WorkspaceRole } from '@modelboard/shared';
import { canComment } from '@modelboard/shared';

export function CommentsPanel({
  boardId,
  token,
  role,
  onClose,
}: {
  boardId: string;
  token: string;
  role: WorkspaceRole;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<any[]>([]);
  const [draft, setDraft] = useState('');

  const load = () => api.comments(boardId, token).then(setComments).catch(console.error);
  useEffect(() => {
    void load();
  }, [boardId, token]);

  const submit = async () => {
    if (!draft.trim()) return;
    await api.addComment(boardId, token, draft);
    setDraft('');
    await load();
  };

  return (
    <aside className="comments-panel">
      <header>
        <div><MessageSquare size={18} /> Comments</div>
        <button className="icon-button" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="comments-panel__list">
        {comments.length === 0 && <p className="muted">No comments yet.</p>}
        {comments.map((comment) => (
          <article className="comment" key={comment.id}>
            <strong>{comment.author_name}</strong>
            <p>{comment.body}</p>
          </article>
        ))}
      </div>
      {canComment(role) && (
        <div className="comments-panel__composer">
          <textarea
            value={draft}
            placeholder="Add a comment…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button onClick={submit} disabled={!draft.trim()}><Send size={16} /> Send</button>
        </div>
      )}
    </aside>
  );
}
