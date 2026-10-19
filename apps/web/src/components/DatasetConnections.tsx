import { useDialogFocus } from '../lib/useDialogFocus';
import { Network, ExternalLink, Unlink, Link, X } from 'lucide-react';
import { datasetRecordLabel as rowName } from '../lib/datasetRecordLabel';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type {
  DatasetRelation,
  DatasetSnapshot,
  DatasetRow,
  DatasetMeta,
} from '@modelboard/shared';
import { relatedRows } from '@modelboard/shared';
import { api } from '../lib/api';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { RelationDialog } from './RelationDialog';
function ConnectionRecords({
  relation,
  dataset,
  onReload,
  onNavigate,
  initialRowId,
}: {
  relation: DatasetRelation;
  dataset: DatasetSnapshot;
  onReload: () => void;
  onNavigate: () => void;
  initialRowId?: string;
}) {
  const {
    sessionToken,
    readOnly,
    openDatasetSheet,
    workspaceId,
    showRelationOnCanvas,
  } = useBoardActions();
  const from = relation.sourceDatasetId === dataset.id,
    otherId = from ? relation.targetDatasetId : relation.sourceDatasetId;
  const { dataset: other } = useCollaborativeDataset(
    otherId,
    sessionToken,
    true,
  );
  const [rowId, setRowId] = useState(initialRowId ?? ''),
    [remoteId, setRemoteId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const row = dataset.rows.find((r) => r.id === rowId),
    matches =
      other && row ? relatedRows(relation, dataset.id, row, other.rows) : [];
  const update = async (local: string, remote: string, remove = false) => {
    setBusy(true);
    setError('');
    try {
      await api.changeRecordLink(workspaceId, relation.id, sessionToken, {
        sourceRowId: from ? local : remote,
        targetRowId: from ? remote : local,
        remove,
      });
      onReload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const left = dataset.columns.find(
    (c) => c.id === (from ? relation.sourceColumnId : relation.targetColumnId),
  )?.name;
  const right = other?.columns.find(
    (c) => c.id === (from ? relation.targetColumnId : relation.sourceColumnId),
  )?.name;
  return (
    <article className="dataset-connection">
      <h4>
        {relation.name || `${dataset.name} → ${other?.name ?? 'Загрузка…'}`} ·{' '}
        {from
          ? relation.cardinality
          : relation.cardinality === '1:N'
            ? 'N:1'
            : relation.cardinality === 'N:1'
              ? '1:N'
              : relation.cardinality}
      </h4>
      <p>
        {relation.matchMode === 'ROW_LINKS'
          ? `Связь записей · ${(relation.links ?? []).length} пар · id/fk не нужны`
          : `Совпадение значений: ${dataset.name}.${left} ↔ ${other?.name}.${right}`}
      </p>
      <button title="Открыть связанную таблицу" aria-label="Открыть связанную таблицу"
        onClick={() => {
          onNavigate();
          openDatasetSheet(otherId);
        }}
      >
        <ExternalLink size={16}/>
      </button>
      {!readOnly && (
        <button title="Показать связь на доске" aria-label="Показать связь на доске"
          onClick={() => {
            onNavigate();
            showRelationOnCanvas(relation);
          }}
        >
          <Network size={16}/>
        </button>
      )}
      <label>
        Посмотреть связи записи
        <select
          aria-label={`Запись в ${dataset.name}`}
          value={rowId}
          onChange={(e) => setRowId(e.target.value)}
        >
          <option value="">Выберите запись</option>
          {dataset.rows.map((r) => (
            <option key={r.id} value={r.id}>
              {rowName(r, dataset)}
            </option>
          ))}
        </select>
      </label>
      {row && (
        <>
          <p>Связанных записей: {matches.length}</p>
          <div className="connection-records-list">{other &&
            matches.map((r) => (
              <div key={r.id}>
                <button className="connection-record-link"
                  onClick={() => {
                    onNavigate();
                    openDatasetSheet(other.id, r.id);
                  }}
                >
                  {rowName(r, other)} ↗
                </button>
                {!readOnly && relation.matchMode === 'ROW_LINKS' && (
                  <button
                    title="Убрать пару" aria-label="Убрать пару" disabled={busy}
                    onClick={() => void update(row.id, r.id, true)}
                  >
                    <Unlink size={14}/>
                  </button>
                )}
              </div>
            ))}</div>
          {!readOnly && relation.matchMode === 'ROW_LINKS' && (
            <>
              <label>
                Добавить связанную запись
                <select
                  aria-label="Добавить связанную запись"
                  value={remoteId}
                  onChange={(e) => setRemoteId(e.target.value)}
                >
                  <option value="">Выберите запись</option>
                  {other?.rows
                    .filter((r) => !matches.some((m) => m.id === r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {rowName(r, other)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy || !remoteId}
                onClick={() => void update(row.id, remoteId)}
              >
                Связать записи
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function DatasetConnections({
  dataset,
  initialRowId,
}: {
  dataset: DatasetSnapshot;
  initialRowId?: string;
}) {
  const { workspaceId, sessionToken, readOnly } = useBoardActions();
  const [open, setOpen] = useState(false),
    [relations, setRelations] = useState<DatasetRelation[]>([]),
    [datasets, setDatasets] = useState<DatasetMeta[]>([]),
    [target, setTarget] = useState(''),
    [create, setCreate] = useState(false),
    [error, setError] = useState('');
  const dialog = useDialogFocus({ open, onClose: () => { setOpen(false); setCreate(false); } });
  const load = () =>
    api
      .relations(workspaceId, sessionToken)
      .then(setRelations)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!open) return;
    void load();
    void api
      .datasets(workspaceId, sessionToken)
      .then(setDatasets)
      .catch((e) => setError(e.message));
    const refresh = () => void load();
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [open, workspaceId, sessionToken]);
  return (
    <>
      <button className="nodrag" title="Связи таблицы" aria-label="Связи таблицы" onClick={() => setOpen(true)}>
        <Link size={15}/>
      </button>
      {open &&
        createPortal(
          <div
            className="dataset-connections-backdrop nodrag nowheel"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <section
              {...dialog}
              className="dataset-connections"
              role="dialog"
              aria-modal="true"
              aria-label="Связи таблицы"
            >
              <header>
                <h3>Связи: {dataset.name}</h3>
                <button title="Закрыть связи" aria-label="Закрыть связи"
                  onClick={() => {
                    setOpen(false);
                    setCreate(false);
                  }}
                >
                  <X size={18}/>
                </button>
              </header>
              <p>
                Выберите запись, чтобы увидеть связанные данные. Связать таблицы
                также можно коннектором на доске.
              </p>
              {error && <p role="alert">{error}</p>}
              {relations
                .filter(
                  (r) =>
                    r.sourceDatasetId === dataset.id ||
                    r.targetDatasetId === dataset.id,
                )
                .map((r) => (
                  <ConnectionRecords
                    key={r.id}
                    relation={r}
                    dataset={dataset}
                    onReload={() => void load()}
                    onNavigate={() => setOpen(false)}
                    initialRowId={initialRowId}
                  />
                ))}
              {!relations.some(
                (r) =>
                  r.sourceDatasetId === dataset.id ||
                  r.targetDatasetId === dataset.id,
              ) && <p>Связей пока нет.</p>}
              {!readOnly && (
                <div>
                  <label>
                    Связать с таблицей
                    <select
                      aria-label="Связать с таблицей"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Выберите таблицу</option>
                      {datasets
                        .filter((d) => d.id !== dataset.id)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button disabled={!target} onClick={() => setCreate(true)}>
                    Настроить новую связь
                  </button>
                </div>
              )}
            </section>
            {create && (
              <RelationDialog
                token={sessionToken}
                relation={{
                  connection: {
                    source: '',
                    target: '',
                    sourceHandle: null,
                    targetHandle: null,
                  },
                  sourceDatasetId: dataset.id,
                  sourceColumnId: '',
                  targetDatasetId: target,
                  targetColumnId: '',
                }}
                onCancel={() => setCreate(false)}
                onConfirm={async (input, existingId) => {
                  if (existingId)
                    await api.appendRecordLinks(
                      workspaceId,
                      existingId,
                      sessionToken,
                      input.links ?? [],
                    );
                  else
                    await api.createRelation(workspaceId, sessionToken, input);
                  setCreate(false);
                  await load();
                }}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
