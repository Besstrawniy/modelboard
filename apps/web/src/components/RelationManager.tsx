import { useEffect, useState } from 'react';
import type {
  DatasetMeta,
  DatasetColumn,
  DatasetRelation,
  CreateDatasetRelationInput,
} from '@modelboard/shared';
import { api } from '../lib/api';
import { useBoardActions } from './BoardContext';
const empty: CreateDatasetRelationInput = {
  sourceDatasetId: '',
  sourceColumnId: '',
  targetDatasetId: '',
  targetColumnId: '',
  relationType: 'REFERENCE',
  cardinality: 'N:1',
  name: '',
  enforceIntegrity: false,
};
export function RelationManager({ datasets }: { datasets: DatasetMeta[] }) {
  const {
    workspaceId,
    sessionToken: token,
    readOnly,
    showRelationOnCanvas,
  } = useBoardActions();
  const [relations, setRelations] = useState<DatasetRelation[]>([]),
    [draft, setDraft] = useState(empty),
    [editing, setEditing] = useState('');
  const [source, setSource] = useState<DatasetColumn[]>([]),
    [target, setTarget] = useState<DatasetColumn[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reports, setReports] = useState<Record<string, string>>({}),
    [deleting, setDeleting] = useState('');
  const load = () =>
    api
      .relations(workspaceId, token)
      .then(setRelations)
      .catch((err) => setError(err.message));
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [workspaceId, token]);
  useEffect(() => {
    let live = true;
    setSource([]);
    if (draft.sourceDatasetId)
      void api
        .datasetColumns(draft.sourceDatasetId, token)
        .then((items) => {
          if (live) setSource(items);
        })
        .catch((err) => setError(err.message));
    return () => {
      live = false;
    };
  }, [draft.sourceDatasetId, token]);
  useEffect(() => {
    let live = true;
    setTarget([]);
    if (draft.targetDatasetId)
      void api
        .datasetColumns(draft.targetDatasetId, token)
        .then((items) => {
          if (live) setTarget(items);
        })
        .catch((err) => setError(err.message));
    return () => {
      live = false;
    };
  }, [draft.targetDatasetId, token]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (editing) await api.updateRelation(workspaceId, editing, token, draft);
      else await api.createRelation(workspaceId, token, draft);
      setDraft(empty);
      setEditing('');
      setReports({});
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="relation-manager" aria-label="Управление связями">
      <h3>Связи данных</h3>
      <p>
        Создавайте связи коннектором между таблицами или через «Связи таблицы». Здесь доступны настройки и проверка связей по значениям полей.
      </p>
      {relations.map((relation) => (
        <article className="relation-card" key={relation.id}>
          <strong>{relation.name || (relation.matchMode==='ROW_LINKS'?'Связь записей':relation.relationType)}</strong>
          <small>
            {datasets.find((d) => d.id === relation.sourceDatasetId)?.name} →{' '}
            {datasets.find((d) => d.id === relation.targetDatasetId)?.name} ·{' '}
            {relation.cardinality || 'без кардинальности'}
          </small>
          <div className="relation-card__actions">
            <button
              onClick={() =>
                void api
                  .validateRelation(workspaceId, relation.id, token)
                  .then((report) =>
                    setReports((previous) => ({
                      ...previous,
                      [relation.id]: report.valid
                        ? `Проверено: ${report.matchedRows} совпадений, ошибок нет`
                        : report.issues.join('; '),
                    })),
                  )
                  .catch((err) => setError(err.message))
              }
            >
              Проверить
            </button>
            {!readOnly && (
              <>
                <button
                  onClick={() => {
                    setDraft({ ...relation, ...(relation.matchMode==='ROW_LINKS'?{links:undefined}:{}) });
                    setEditing(relation.id);
                    setError('');
                  }}
                >
                  {relation.matchMode==='ROW_LINKS'?'Настроить кардинальность':'Настроить'}
                </button>
                <button
                  onClick={() => {
                    showRelationOnCanvas(relation);
                  }}
                >
                  Показать ER
                </button>
                <button onClick={() => setDeleting(relation.id)}>
                  Удалить связь
                </button>
              </>
            )}
          </div>
          {reports[relation.id] && <p role="status">{reports[relation.id]}</p>}
          {deleting === relation.id && (
            <div role="alertdialog" aria-label="Удалить связь">
              <p>
                Удалить связь и её линии/представления со всех досок? Таблицы и
                записи сохранятся.
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.deleteRelation(workspaceId, relation.id, token);
                    setDeleting('');
                    if (editing === relation.id) {
                      setEditing('');
                      setDraft(empty);
                    }
                    await load();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Подтвердить удаление связи
              </button>
              <button onClick={() => setDeleting('')}>Отмена</button>
            </div>
          )}
        </article>
      ))}
      {!readOnly && (
        <div className="relation-editor">
          <h4>{editing ? 'Настроить связь' : 'Новая связь'}</h4>{draft.matchMode==='ROW_LINKS'&&<p>Пары записей можно добавлять и удалять через кнопку «Связи таблицы» на таблице.</p>}
          <label>
            Название связи
            <input
              aria-label="Название связи"
              value={draft.name ?? ''}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Исходный Dataset
            <select
              aria-label="Исходный Dataset"
              value={draft.sourceDatasetId}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sourceDatasetId: e.target.value,
                  sourceColumnId: '',
                })
              }
            >
              <option value="">Выберите Dataset</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Исходное поле
            <select
              disabled={draft.matchMode==='ROW_LINKS'} aria-label="Исходное поле"
              value={draft.sourceColumnId}
              onChange={(e) =>
                setDraft({ ...draft, sourceColumnId: e.target.value })
              }
            >
              <option value="">Выберите поле</option>
              {source.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.dataType}
                </option>
              ))}
            </select>
          </label>
          <label>
            Целевой Dataset
            <select
              aria-label="Целевой Dataset"
              value={draft.targetDatasetId}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  targetDatasetId: e.target.value,
                  targetColumnId: '',
                })
              }
            >
              <option value="">Выберите Dataset</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Целевое поле
            <select
              disabled={draft.matchMode==='ROW_LINKS'} aria-label="Целевое поле"
              value={draft.targetColumnId}
              onChange={(e) =>
                setDraft({ ...draft, targetColumnId: e.target.value })
              }
            >
              <option value="">Выберите поле</option>
              {target.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.dataType}
                </option>
              ))}
            </select>
          </label>
          <label>
            Тип связи
            <select
              aria-label="Тип связи"
              value={draft.relationType}
              onChange={(e) =>
                setDraft({ ...draft, relationType: e.target.value as any })
              }
            >
              {[
                ['REFERENCE', 'REF — ссылка'],
                ['FOREIGN_KEY', 'FK — внешний ключ'],
                ['DEPENDENCY', 'DEP — зависимость'],
                ['MAP', 'MAP — соответствие'],
                ['FLOW', 'FLOW — поток'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Кардинальность
            <select
              aria-label="Кардинальность"
              value={draft.cardinality ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, cardinality: e.target.value as any })
              }
            >
              <option value="">Не указана</option>
              {['1:1', '1:N', 'N:1', 'N:M'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="relation-checkbox">
            <input
              type="checkbox"
              checked={
                draft.relationType === 'FOREIGN_KEY' ||
                Boolean(draft.enforceIntegrity)
              }
              disabled={draft.relationType === 'FOREIGN_KEY'}
              onChange={(e) =>
                setDraft({ ...draft, enforceIntegrity: e.target.checked })
              }
            />
            Контролировать целостность при записи
          </label>
          <button
            disabled={busy || !draft.sourceColumnId || !draft.targetColumnId}
            onClick={() => void save()}
          >
            {busy
              ? 'Сохранение…'
              : editing
                ? 'Сохранить связь'
                : 'Создать связь'}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing('');
                setDraft(empty);
              }}
            >
              Отменить редактирование
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="inspector-error">
          {error}
        </p>
      )}
    </section>
  );
}
