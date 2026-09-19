import { Database, Link2, Trash2, X } from 'lucide-react';
import type {
  DatasetMeta,
  DeviceKind,
  ObjectBindingRecord,
} from '@modelboard/shared';
import type { Node } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { RelatedRecords } from './RelatedRecords';
import { DEVICE_LABELS } from './DeviceNode';

function rowLabel(
  row: { id: string; values: Record<string, unknown> },
  columns: Array<{ id: string; name: string }>,
) {
  const parts = columns
    .slice(0, 3)
    .map((column) => row.values[column.id])
    .filter((value) => value !== null && value !== undefined && String(value) !== '')
    .map(String);

  return parts.length ? parts.join(' · ') : row.id;
}

export function InspectorPanel({
  node,
  boardId,
  workspaceId,
  token,
  readOnly,
  onClose,
  onUpdateNodeData,
}: {
  node: Node;
  boardId: string;
  workspaceId: string;
  token: string;
  readOnly: boolean;
  onClose: () => void;
  onUpdateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const existingBinding = (node.data as any)?.binding as ObjectBindingRecord | undefined;
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetId, setDatasetId] = useState(existingBinding?.datasetId ?? '');
  const [rowId, setRowId] = useState(existingBinding?.rowId ?? '');
  const [titleColumnId, setTitleColumnId] = useState(
    existingBinding?.presentation?.titleColumnId as string | undefined ?? '',
  );
  const [subtitleColumnId, setSubtitleColumnId] = useState(
    existingBinding?.presentation?.subtitleColumnId as string | undefined ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { dataset } = useCollaborativeDataset(
    datasetId || undefined,
    token,
    true,
  );

  useEffect(() => {
    void api.datasets(workspaceId, token)
      .then(setDatasets)
      .catch((err) => setError(String(err)));
  }, [token, workspaceId]);

  useEffect(() => {
    const binding = (node.data as any)?.binding as ObjectBindingRecord | undefined;
    setDatasetId(binding?.datasetId ?? '');
    setRowId(binding?.rowId ?? '');
    setTitleColumnId(
      (binding?.presentation?.titleColumnId as string | undefined) ?? '',
    );
    setSubtitleColumnId(
      (binding?.presentation?.subtitleColumnId as string | undefined) ?? '',
    );
    setError('');
  }, [node.id, node.data]);

  const selectedDatasetMeta = useMemo(
    () => datasets.find((item) => item.id === datasetId),
    [datasetId, datasets],
  );

  const boundRow =
    existingBinding?.rowId &&
    dataset?.id === existingBinding.datasetId
      ? dataset.rows.find((row) => row.id === existingBinding.rowId)
      : undefined;

  const saveBinding = async () => {
    if (!datasetId || !rowId) return;

    setBusy(true);
    setError('');
    try {
      const binding = await api.upsertObjectBinding(
        boardId,
        node.id,
        token,
        {
          type: 'ROW',
          datasetId,
          rowId,
          presentation: {
            ...(titleColumnId ? { titleColumnId } : {}),
            ...(subtitleColumnId ? { subtitleColumnId } : {}),
          },
        },
      );

      onUpdateNodeData(node.id, { binding });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeBinding = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteObjectBinding(boardId, node.id, token);
      onUpdateNodeData(node.id, { binding: null });
      setDatasetId('');
      setRowId('');
      setTitleColumnId('');
      setSubtitleColumnId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="inspector-panel">
      <header>
        <div>
          <strong>Инспектор</strong>
          <small>{node.type ?? 'object'} · {node.id.slice(0, 8)}</small>
        </div>
        <button className="icon-button" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="inspector-panel__body">
        <section className="inspector-section">
          <h3>Объект</h3>
          <label>
            Тип
            <input value={node.type ?? 'unknown'} disabled />
          </label>

          {(node.type === 'shape' || node.type === 'sticky' || node.type === 'text') && (
            <label>
              Текст
              <textarea
                disabled={readOnly}
                value={String((node.data as any)?.text ?? '')}
                onChange={(event) =>
                  onUpdateNodeData(node.id, { text: event.target.value })
                }
              />
            </label>
          )}

          {node.type === 'device' && (
            <>
              <label>
                Тип устройства
                <select
                  disabled={readOnly}
                  value={String((node.data as any)?.deviceKind ?? 'SERVER')}
                  onChange={(event) =>
                    onUpdateNodeData(node.id, {
                      deviceKind: event.target.value as DeviceKind,
                    })
                  }
                >
                  {Object.entries(DEVICE_LABELS).map(([kind, label]) => (
                    <option key={kind} value={kind}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Подпись
                <input
                  disabled={readOnly}
                  value={String((node.data as any)?.label ?? '')}
                  onChange={(event) =>
                    onUpdateNodeData(node.id, {
                      label: event.target.value,
                    })
                  }
                />
              </label>
            </>
          )}
        </section>

        {node.type === 'table' && (
          <section className="inspector-section">
            <h3><Database size={14} /> Dataset</h3>
            <p className="inspector-muted">
              Этот TableNode является представлением Dataset:
            </p>
            <code>{String((node.data as any)?.datasetId ?? '—')}</code>
          </section>
        )}

        {(node.type === 'shape' || node.type === 'device') && (
          <section className="inspector-section">
            <h3><Link2 size={14} /> Привязка данных</h3>

            <label>
              Dataset
              <select
                disabled={readOnly || busy}
                value={datasetId}
                onChange={(event) => {
                  setDatasetId(event.target.value);
                  setRowId('');
                  setTitleColumnId('');
                  setSubtitleColumnId('');
                }}
              >
                <option value="">Не выбран</option>
                {datasets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.kind}
                  </option>
                ))}
              </select>
            </label>

            {datasetId && (
              <label>
                Строка
                <select
                  disabled={readOnly || busy || !dataset}
                  value={rowId}
                  onChange={(event) => setRowId(event.target.value)}
                >
                  <option value="">Выберите строку</option>
                  {dataset?.rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {rowLabel(row, dataset.columns)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {rowId && dataset && (
              <>
                <label>
                  Поле заголовка
                  <select
                    disabled={readOnly || busy}
                    value={titleColumnId}
                    onChange={(event) => setTitleColumnId(event.target.value)}
                  >
                    <option value="">Автоматически</option>
                    {dataset.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Поле подзаголовка
                  <select
                    disabled={readOnly || busy}
                    value={subtitleColumnId}
                    onChange={(event) => setSubtitleColumnId(event.target.value)}
                  >
                    <option value="">Нет</option>
                    {dataset.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {selectedDatasetMeta && (
              <p className="inspector-muted">
                Источник: <strong>{selectedDatasetMeta.name}</strong>
              </p>
            )}

            {!readOnly && (
              <div className="inspector-actions">
                <button
                  className="primary-button"
                  disabled={!datasetId || !rowId || busy}
                  onClick={saveBinding}
                >
                  <Link2 size={14} />
                  {busy ? 'Сохранение…' : 'Привязать'}
                </button>

                {existingBinding && (
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={removeBinding}
                  >
                    <Trash2 size={14} />
                    Отвязать
                  </button>
                )}
              </div>
            )}

            {error && <div className="inspector-error">{error}</div>}
          </section>
        )}

        {(node.type === 'shape' || node.type === 'device') && existingBinding && dataset && boundRow && (
          <>
            <section className="inspector-section">
              <h3><Database size={14} /> Текущие данные</h3>
              <div className="bound-row-fields">
                {dataset.columns.map((column) => (
                  <div className="bound-row-field" key={column.id}>
                    <small>{column.name}</small>
                    <strong>
                      {String(boundRow.values[column.id] ?? '—')}
                    </strong>
                  </div>
                ))}
              </div>
            </section>

            <RelatedRecords
              workspaceId={workspaceId}
              token={token}
              dataset={dataset}
              row={boundRow}
              parentNodeId={node.id}
            />
          </>
        )}
      </div>
    </aside>
  );
}
