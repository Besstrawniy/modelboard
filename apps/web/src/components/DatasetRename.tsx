import { TextCursorInput, Check, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
export function DatasetRename({
  id,
  name,
  token,
  readOnly,
  onSaved,
}: {
  id: string;
  name: string;
  token: string;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(name),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (readOnly) return null;
  return (
    <span
      className="dataset-rename nodrag"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api.renameDataset(id, token, draft);
              setEditing(false);
              onSaved?.();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            autoFocus
            aria-label="Имя Dataset"
            maxLength={120}
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button disabled={busy} title="Сохранить имя" aria-label="Сохранить имя"><Check size={15}/></button>
          <button
            title="Отмена" aria-label="Отмена" type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            <X size={15}/>
          </button>
          {error && <span role="alert">{error}</span>}
        </form>
      ) : (
        <button
          title="Редактировать имя Dataset" aria-label="Редактировать имя Dataset"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          <TextCursorInput size={15}/>
        </button>
      )}
    </span>
  );
}
