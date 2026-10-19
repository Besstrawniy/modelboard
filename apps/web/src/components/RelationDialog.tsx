import { sameRelationEndpoints } from '@modelboard/shared';
import { datasetRecordLabel as label } from '../lib/datasetRecordLabel';
import { api } from '../lib/api';
import { useBoardActions } from './BoardContext';
import { Link2, X } from 'lucide-react';
import type {
  CreateDatasetRelationInput,
  DatasetRelationCardinality,
  DatasetRow,
  DatasetSnapshot,
  DatasetRelation,
} from '@modelboard/shared';
import type { Connection } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

export type PendingRelation = {
  connection: Connection;
  sourceDatasetId: string;
  sourceColumnId: string;
  targetDatasetId: string;
  targetColumnId: string;
  sourceRowId?: string;
  targetRowId?: string;
};
export function RelationDialog({
  relation,
  token,
  onCancel,
  onConfirm,
}: {
  relation: PendingRelation;
  token: string;
  onCancel: () => void;
  onConfirm: (
    input: CreateDatasetRelationInput,
    existingId?: string,
  ) => Promise<void>;
}) {
  const { workspaceId } = useBoardActions();
  const [existing, setExisting] = useState<DatasetRelation[]>([]),
    [existingId, setExistingId] = useState('');
  const [fieldRelations, setFieldRelations] = useState<DatasetRelation[]>([]);
  useEffect(() => {
    let live = true;
    void api
      .relations(workspaceId, token)
      .then((items) => {
        if (live) {
          setFieldRelations(
            items.filter((r) => (r.matchMode ?? 'FIELDS') === 'FIELDS'),
          );
          setExisting(
            items.filter(
              (r) =>
                r.matchMode === 'ROW_LINKS' &&
                r.sourceDatasetId === relation.sourceDatasetId &&
                r.targetDatasetId === relation.targetDatasetId,
            ),
          );
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [workspaceId, token, relation.sourceDatasetId, relation.targetDatasetId]);
  const { dataset: source } = useCollaborativeDataset(
    relation.sourceDatasetId,
    token,
    true,
  );
  const { dataset: target } = useCollaborativeDataset(
    relation.targetDatasetId,
    token,
    true,
  );
  const [mode, setMode] = useState<'FIELDS' | 'ROW_LINKS'>(
    relation.sourceColumnId && relation.targetColumnId ? 'FIELDS' : 'ROW_LINKS',
  );
  const [sourceColumn, setSourceColumn] = useState(relation.sourceColumnId),
    [targetColumn, setTargetColumn] = useState(relation.targetColumnId);
  const [sourceRow, setSourceRow] = useState(relation.sourceRowId ?? ''),
    [targetRow, setTargetRow] = useState(relation.targetRowId ?? '');
  const [links, setLinks] = useState<
    Array<{ sourceRowId: string; targetRowId: string }>
  >([]);
  const [cardinality, setCardinality] =
    useState<DatasetRelationCardinality>('1:N');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const duplicateField =
    mode === 'FIELDS' &&
    sourceColumn &&
    targetColumn &&
    fieldRelations.find((item) =>
      sameRelationEndpoints(item, {
        sourceDatasetId: relation.sourceDatasetId,
        targetDatasetId: relation.targetDatasetId,
        sourceColumnId: sourceColumn,
        targetColumnId: targetColumn,
        matchMode: 'FIELDS',
      }),
    );
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const pairs = [...links];
      if (
        sourceRow &&
        targetRow &&
        !pairs.some(
          (p) => p.sourceRowId === sourceRow && p.targetRowId === targetRow,
        )
      )
        pairs.push({ sourceRowId: sourceRow, targetRowId: targetRow });
      if (mode === 'ROW_LINKS' && !pairs.length)
        throw new Error('Выберите две записи и добавьте пару.');
      if (mode === 'FIELDS' && (!sourceColumn || !targetColumn))
        throw new Error('Выберите поля обеих таблиц.');
      await onConfirm(
        {
          sourceDatasetId: relation.sourceDatasetId,
          targetDatasetId: relation.targetDatasetId,
          sourceColumnId: mode === 'FIELDS' ? sourceColumn : '__row__',
          targetColumnId: mode === 'FIELDS' ? targetColumn : '__row__',
          matchMode: mode,
          links: pairs,
          relationType:
            mode === 'FIELDS' && cardinality !== 'N:M'
              ? 'FOREIGN_KEY'
              : 'REFERENCE',
          cardinality,
          enforceIntegrity: true,
        },
        existingId || undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="relation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Создать связь данных"
      >
        <header className="relation-dialog__header">
          <div>
            <Link2 size={18} /> Создать связь данных
          </div>
          <button className="icon-button" disabled={busy} onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <div className="relation-dialog__body">
          <p>
            <strong>{source?.name ?? 'Загрузка…'}</strong> →{' '}
            <strong>{target?.name ?? 'Загрузка…'}</strong>
          </p>
          {existing.length > 0 && (
            <label>
              Использовать связь
              <select
                aria-label="Использовать связь"
                value={existingId}
                onChange={(e) => {
                  setExistingId(e.target.value);
                  const current = existing.find((r) => r.id === e.target.value);
                  if (current) {
                    setMode('ROW_LINKS');
                    setCardinality(current.cardinality ?? '1:N');
                  }
                }}
              >
                <option value="">Создать новую связь</option>
                {existing.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || 'Связь записей'} · {r.cardinality} ·{' '}
                    {(r.links ?? []).length} пар
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="relation-form">
            <label>
              Способ связи
              <select
                aria-label="Способ связи"
                disabled={Boolean(existingId)}
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="ROW_LINKS">Выбрать записи — без id/fk</option>
                <option value="FIELDS">По совпадающим значениям полей</option>
              </select>
            </label>
            <label>
              Кардинальность
              <select
                aria-label="Кардинальность"
                disabled={Boolean(existingId)}
                value={cardinality}
                onChange={(e) =>
                  setCardinality(e.target.value as DatasetRelationCardinality)
                }
              >
                <option value="1:1">1:1 — одна запись к одной</option>
                <option value="1:N">1:N — одна запись к нескольким</option>
                <option value="N:1">N:1 — несколько записей к одной</option>
                <option value="N:M">N:M — несколько к нескольким</option>
              </select>
            </label>
          </div>
          <p className="relation-dialog__hint">
            {cardinality === '1:N'
              ? 'Одна запись слева может иметь несколько связанных записей справа. Каждая запись справа принадлежит одной записи слева.'
              : cardinality === '1:1'
                ? 'Каждая запись с обеих сторон может участвовать только в одной паре.'
                : cardinality === 'N:1'
                  ? 'Несколько записей слева могут ссылаться на одну справа.'
                  : 'Записи с обеих сторон могут участвовать в нескольких парах.'}
          </p>
          {mode === 'FIELDS' ? (
            <>
              <div className="relation-form">
                {[
                  [source, sourceColumn, setSourceColumn],
                  [target, targetColumn, setTargetColumn],
                ].map(([ds, value, set], i) => (
                  <label key={i}>
                    {i ? 'Поле справа' : 'Поле слева'}
                    <select
                      aria-label={i ? 'Поле справа' : 'Поле слева'}
                      value={value as string}
                      onChange={(e) =>
                        (set as (v: string) => void)(e.target.value)
                      }
                    >
                      <option value="">Выберите поле</option>
                      {(ds as DatasetSnapshot | null)?.columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.dataType})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p>
                Совпадающие значения связываются автоматически. Для 1:N поле
                слева должно быть уникальным; значения справа должны
                существовать слева. Сначала заполните ключи в таблицах.
              </p>
            </>
          ) : (
            <>
              <label>
                Найти запись
                <input
                  aria-label="Найти запись"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="relation-form">
                {[
                  [source, sourceRow, setSourceRow],
                  [target, targetRow, setTargetRow],
                ].map(([ds, value, set], i) => (
                  <label key={i}>
                    {i ? 'Запись справа' : 'Запись слева'}
                    <select
                      aria-label={i ? 'Запись справа' : 'Запись слева'}
                      value={value as string}
                      onChange={(e) =>
                        (set as (v: string) => void)(e.target.value)
                      }
                    >
                      <option value="">Выберите запись</option>
                      {(ds as DatasetSnapshot | null)?.rows
                        .filter(
                          (row) =>
                            row.id === value ||
                            label(row, ds as DatasetSnapshot)
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                        )
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {label(row, ds as DatasetSnapshot)}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                disabled={!sourceRow || !targetRow}
                onClick={() => {
                  if (
                    !links.some(
                      (p) =>
                        p.sourceRowId === sourceRow &&
                        p.targetRowId === targetRow,
                    )
                  )
                    setLinks([
                      ...links,
                      { sourceRowId: sourceRow, targetRowId: targetRow },
                    ]);
                  setTargetRow('');
                }}
              >
                Добавить пару
              </button>
              <ul>
                {links.map((pair, i) => (
                  <li key={pair.sourceRowId + pair.targetRowId}>
                    {source &&
                    source.rows.find((r) => r.id === pair.sourceRowId)
                      ? label(
                          source.rows.find((r) => r.id === pair.sourceRowId)!,
                          source,
                        )
                      : 'Запись'}{' '}
                    →{' '}
                    {target &&
                    target.rows.find((r) => r.id === pair.targetRowId)
                      ? label(
                          target.rows.find((r) => r.id === pair.targetRowId)!,
                          target,
                        )
                      : 'Запись'}{' '}
                    <button
                      onClick={() => setLinks(links.filter((_, j) => j !== i))}
                    >
                      Убрать
                    </button>
                  </li>
                ))}
              </ul>
              <p>
                Номер строки — её позиция, он может меняться. Связь сохраняется
                по внутреннему ID записи и продолжает работать при сортировке и
                переименовании полей.
              </p>
            </>
          )}
          {duplicateField && (
            <p role="status">
              Эти поля уже связаны. Откройте «Связи таблицы», чтобы настроить
              существующую связь.
            </p>
          )}
          {error && (
            <div className="relation-dialog__error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="relation-dialog__footer">
          <button disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={busy || !source || !target || Boolean(duplicateField)}
            onClick={submit}
          >
            {busy ? 'Сохранение…' : 'Создать связь'}
          </button>
        </footer>
      </section>
    </div>
  );
}
