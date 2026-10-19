import { DatasetConnections } from './DatasetConnections';
import { CanvasProperties } from './CanvasProperties';
import {
  resolveBindingPresentation,
  type ObjectBindingType,
} from '@modelboard/shared';
import {
  Database,
  ExternalLink,
  LayoutDashboard,
  Link2,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BoardDatasetLocation,
  DatasetMeta,
  DeviceKind,
  ObjectBindingRecord,
} from '@modelboard/shared';
import type { Node } from '@xyflow/react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { RelatedRecords } from './RelatedRecords';
import { DEVICE_LABELS } from './DeviceNode';
import { useBoardActions } from './BoardContext';

function rowLabel(
  row: { id: string; values: Record<string, unknown> },
  columns: Array<{ id: string; name: string }>,
) {
  const parts = columns
    .map((column) => row.values[column.id])
    .filter(
      (value) => value !== null && value !== undefined && String(value) !== '',
    )
    .map(String);

  return parts.length ? parts.join(' · ') : row.id;
}

function suggestedPresentationFields(
  columns: Array<{ id: string; name: string }>,
) {
  const normalized = new Map(
    columns.map((column) => [column.name.trim().toLowerCase(), column.id]),
  );

  const first = (names: string[]) =>
    names
      .map((name) => normalized.get(name))
      .find((value): value is string => Boolean(value)) ?? '';

  const title =
    first([
      'hostname',
      'name',
      'title',
      'label',
      'service',
      'device',
      'server',
      'id',
    ]) ||
    columns[0]?.id ||
    '';

  const subtitle =
    first(['ip', 'ip_address', 'address', 'fqdn', 'status', 'port']) ||
    columns.find((column) => column.id !== title)?.id ||
    '';

  return { title, subtitle };
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
  const { openDatasetSheet, navigateToDatasetLocation } = useBoardActions();
  const existingBinding = (node.data as any)?.binding as
    | ObjectBindingRecord
    | undefined;
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetId, setDatasetId] = useState(existingBinding?.datasetId ?? '');
  const [rowId, setRowId] = useState(existingBinding?.rowId ?? '');
  const [titleColumnId, setTitleColumnId] = useState(
    (existingBinding?.presentation?.titleColumnId as string | undefined) ?? '',
  );
  const [subtitleColumnId, setSubtitleColumnId] = useState(
    (existingBinding?.presentation?.subtitleColumnId as string | undefined) ??
      '',
  );
  const [bindingType, setBindingType] = useState<ObjectBindingType>(
    existingBinding?.type ?? 'ROW',
  );
  const [columnId, setColumnId] = useState(existingBinding?.columnId ?? '');
  const [fieldIds, setFieldIds] = useState<string[]>(
    existingBinding?.presentation?.fieldColumnIds ?? [],
  );
  const [statusColumnId, setStatusColumnId] = useState(
    existingBinding?.presentation?.statusColumnId ?? '',
  );
  const [statusColors, setStatusColors] = useState('');
  const [aggregation, setAggregation] = useState<
    'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'FIRST'
  >(existingBinding?.presentation?.aggregation ?? 'COUNT');
  const [showLabels, setShowLabels] = useState(
    existingBinding?.presentation?.showLabels !== false,
  );
  const suggestedFor = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [datasetLocations, setDatasetLocations] = useState<
    BoardDatasetLocation[]
  >([]);
  const [rowSearch, setRowSearch] = useState('');

  const { dataset } = useCollaborativeDataset(
    datasetId || undefined,
    token,
    true,
  );

  useEffect(() => {
    const load = () =>
      api
        .datasets(workspaceId, token)
        .then(setDatasets)
        .catch((err) => setError(String(err)));
    void load();
    const refresh = () => void load();
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [token, workspaceId]);

  const locationDatasetId =
    node.type === 'table'
      ? String((node.data as any)?.datasetId ?? '')
      : (existingBinding?.datasetId ?? '');

  useEffect(() => {
    if (!locationDatasetId) {
      setDatasetLocations([]);
      return;
    }

    void api
      .datasetLocations(workspaceId, locationDatasetId, token)
      .then(setDatasetLocations)
      .catch((err) => setError(String(err)));
  }, [locationDatasetId, token, workspaceId]);

  useEffect(() => {
    const binding = (node.data as any)?.binding as
      | ObjectBindingRecord
      | undefined;
    setBindingType(binding?.type ?? 'ROW');
    setColumnId(binding?.columnId ?? '');
    setFieldIds(binding?.presentation?.fieldColumnIds ?? []);
    setStatusColumnId(binding?.presentation?.statusColumnId ?? '');
    setAggregation(binding?.presentation?.aggregation ?? 'COUNT');
    setShowLabels(binding?.presentation?.showLabels !== false);
    setStatusColors(
      Object.entries(binding?.presentation?.statusColors ?? {})
        .map(([value, color]) => `${value}=${color}`)
        .join('; '),
    );
    suggestedFor.current = '';
    setDatasetId(binding?.datasetId ?? '');
    setRowId(binding?.rowId ?? '');
    setTitleColumnId(
      (binding?.presentation?.titleColumnId as string | undefined) ?? '',
    );
    setSubtitleColumnId(
      (binding?.presentation?.subtitleColumnId as string | undefined) ?? '',
    );
    setRowSearch('');
    setError('');
  }, [node.id, JSON.stringify(existingBinding)]);

  const selectedDatasetMeta = useMemo(
    () => datasets.find((item) => item.id === datasetId),
    [datasetId, datasets],
  );

  useEffect(() => {
    if (!dataset || dataset.id !== datasetId) return;

    if (suggestedFor.current === datasetId || !dataset.columns.length) return;
    suggestedFor.current = datasetId;
    if (existingBinding?.datasetId === datasetId) return;
    const suggested = suggestedPresentationFields(dataset.columns);

    if (!titleColumnId) {
      setTitleColumnId(suggested.title);
    }
    if (!subtitleColumnId) {
      setSubtitleColumnId(suggested.subtitle);
    }
  }, [
    dataset?.id,
    dataset?.columns,
    datasetId,
    subtitleColumnId,
    titleColumnId,
  ]);

  const filteredRows = useMemo(() => {
    if (!dataset) return [];

    const needle = rowSearch.trim().toLowerCase();
    if (!needle) return dataset.rows;

    return dataset.rows.filter((row) =>
      rowLabel(row, dataset.columns).toLowerCase().includes(needle),
    );
  }, [dataset, rowSearch]);

  const boundRow =
    existingBinding?.rowId && dataset?.id === existingBinding.datasetId
      ? dataset.rows.find((row) => row.id === existingBinding.rowId)
      : undefined;

  const saveBinding = async () => {
    if (
      !datasetId ||
      (['ROW', 'CELL'].includes(bindingType) && !rowId) ||
      (['COLUMN', 'CELL'].includes(bindingType) && !columnId)
    )
      return;

    setBusy(true);
    setError('');
    try {
      const binding = await api.upsertObjectBinding(boardId, node.id, token, {
        type: bindingType,
        datasetId,
        ...(['ROW', 'CELL'].includes(bindingType) ? { rowId } : {}),
        ...(['COLUMN', 'CELL'].includes(bindingType) ? { columnId } : {}),
        presentation: {
          fieldColumnIds: fieldIds,
          statusColumnId: statusColumnId || undefined,
          showLabels,
          aggregation,
          statusColors: Object.fromEntries(
            statusColors
              .split(';')
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => {
                const i = item.lastIndexOf('=');
                return [item.slice(0, i).trim(), item.slice(i + 1).trim()];
              }),
          ),
          ...(titleColumnId ? { titleColumnId } : {}),
          ...(subtitleColumnId ? { subtitleColumnId } : {}),
        },
      });

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

  const preview = dataset
    ? resolveBindingPresentation(
        {
          type: bindingType,
          datasetId,
          rowId,
          columnId,
          presentation: {
            titleColumnId,
            subtitleColumnId,
            fieldColumnIds: fieldIds,
            showLabels,
            aggregation,
            statusColumnId,
          },
        },
        dataset,
      )
    : null;

  return (
    <aside className="inspector-panel">
      <header>
        <div>
          <strong>Инспектор</strong>
          <small>
            {node.type ?? 'object'} · {node.id.slice(0, 8)}
          </small>
        </div>
        <button className="icon-button" onClick={onClose}>
          <X size={17} />
        </button>
      </header>


      <div className="inspector-panel__body">
      {!readOnly && <CanvasProperties node={node} onChange={patch=>onUpdateNodeData(node.id,patch)} />}
        <section className="inspector-section">
          <h3>Объект</h3>
          <label>
            Тип
            <input value={node.type ?? 'unknown'} disabled />
          </label>

          {(node.type === 'shape' ||
            node.type === 'sticky' ||
            node.type === 'text') && (
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

          {node.type === 'template' && (
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
          )}

          {node.type === 'frame' && (
            <>
              <label>
                Название секции
                <input
                  disabled={readOnly}
                  value={String((node.data as any)?.title ?? '')}
                  onChange={(event) =>
                    onUpdateNodeData(node.id, {
                      title: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Описание
                <textarea
                  disabled={readOnly}
                  value={String((node.data as any)?.description ?? '')}
                  onChange={(event) =>
                    onUpdateNodeData(node.id, {
                      description: event.target.value,
                    })
                  }
                />
              </label>
            </>
          )}
        </section>

        {node.type === 'table' && (
          <section className="inspector-section">
            <h3>
              <Database size={14} /> Dataset
            </h3>
            <p className="inspector-muted">
              Этот TableNode является представлением Dataset:
            </p>
            <code>{String((node.data as any)?.datasetId ?? '—')}</code>
          </section>
        )}

        {(node.type === 'shape' ||
          node.type === 'device' ||
          node.type === 'template') &&
          existingBinding &&
          dataset &&
          boundRow && (
            <>
              <section className="inspector-section">
                <h3>
                  <Database size={14} /> Текущие данные
                </h3>
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

                <button
                  className="secondary-button inspector-open-dataset"
                  onClick={() =>
                    openDatasetSheet(
                      existingBinding.datasetId,
                      existingBinding.rowId,
                    )
                  }
                >
                  <Table2 size={14} />
                  Открыть в таблице
                </button>
              </section>

              <DatasetConnections dataset={dataset} initialRowId={boundRow.id}/>
              <RelatedRecords
                workspaceId={workspaceId}
                token={token}
                dataset={dataset}
                row={boundRow}
                parentNodeId={node.id}
              />
            </>
          )}

        {(node.type === 'shape' ||
          node.type === 'device' ||
          node.type === 'template') && (
          <section className="inspector-section">
            <h3>
              <Link2 size={14} /> Привязка данных
            </h3>

            <div className="binding-guide">
              <strong>Настраиваемое представление данных</strong>
              <p>
                После привязки изменение данных в таблице автоматически
                обновляет этот объект на canvas.
              </p>
              <div>
                <span>1</span> Dataset
                <span>2</span> Строка
                <span>3</span> Что показывать
                <span>4</span> Привязать
              </div>
            </div>

            {existingBinding && dataset && boundRow && (
              <div className="binding-current">
                <span>Привязано</span>
                <strong>
                  {dataset.name} → {rowLabel(boundRow, dataset.columns)}
                </strong>
                <small>rowId: {boundRow.id.slice(0, 8)}…</small>
              </div>
            )}

            <label>
              Тип привязки
              <select
                aria-label="Тип привязки"
                value={bindingType}
                disabled={readOnly || busy}
                onChange={(e) =>
                  setBindingType(e.target.value as ObjectBindingType)
                }
              >
                <option value="ROW">Строка — поля записи</option>
                <option value="CELL">Ячейка — одно значение</option>
                <option value="COLUMN">Колонка — агрегат</option>
                <option value="DATASET">Dataset — сводка</option>
              </select>
            </label>
            <label>
              <span className="binding-step-label">
                <b>1</b> Dataset
              </span>
              <select
                disabled={readOnly || busy}
                aria-label="Dataset привязки"
                value={datasetId}
                onChange={(event) => {
                  suggestedFor.current = '';
                  setColumnId('');
                  setFieldIds([]);
                  setStatusColumnId('');
                  setDatasetId(event.target.value);
                  setRowId('');
                  setRowSearch('');
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

            {datasetId && ['ROW', 'CELL'].includes(bindingType) && (
              <div className="binding-row-picker">
                <label>
                  <span className="binding-step-label">
                    <b>2</b> Строка Dataset
                  </span>
                  <input
                    disabled={readOnly || busy || !dataset}
                    value={rowSearch}
                    placeholder="Поиск по значениям строки…"
                    onChange={(event) => setRowSearch(event.target.value)}
                  />
                </label>

                <label>
                  <select
                    disabled={readOnly || busy || !dataset}
                    aria-label="Строка привязки"
                    value={rowId}
                    onChange={(event) => setRowId(event.target.value)}
                    size={Math.min(7, Math.max(2, filteredRows.length + 1))}
                  >
                    <option value="">Выберите строку</option>
                    {filteredRows.slice(0, 200).map((row) => (
                      <option key={row.id} value={row.id}>
                        {rowLabel(row, dataset!.columns)}
                      </option>
                    ))}
                  </select>
                </label>

                {filteredRows.length > 200 && (
                  <p className="inspector-muted">
                    Первые 200 результатов. Уточните поиск для остальных
                    записей.
                  </p>
                )}
                {dataset && filteredRows.length === 0 && (
                  <p className="inspector-muted">
                    По запросу строк не найдено.
                  </p>
                )}
              </div>
            )}

            {rowId && dataset && bindingType === 'ROW' && (
              <>
                <label>
                  <span className="binding-step-label">
                    <b>3</b> Поле заголовка
                  </span>
                  <select
                    disabled={readOnly || busy}
                    aria-label="Поле заголовка"
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
                    aria-label="Поле подзаголовка"
                    value={subtitleColumnId}
                    onChange={(event) =>
                      setSubtitleColumnId(event.target.value)
                    }
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

            {dataset && ['COLUMN', 'CELL'].includes(bindingType) && (
              <label>
                Поле привязки
                <select
                  aria-label="Поле привязки"
                  value={columnId}
                  disabled={readOnly || busy}
                  onChange={(e) => setColumnId(e.target.value)}
                >
                  <option value="">Выберите поле</option>
                  {dataset.columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dataset && bindingType === 'COLUMN' && (
              <label>
                Агрегат
                <select
                  aria-label="Агрегат"
                  disabled={readOnly || busy}
                  value={aggregation}
                  onChange={(e) => setAggregation(e.target.value as any)}
                >
                  {['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'FIRST'].map(
                    (mode) => (
                      <option key={mode}>{mode}</option>
                    ),
                  )}
                </select>
              </label>
            )}
            {dataset && bindingType === 'ROW' && (
              <>
                <span>Поля на объекте (до 12)</span>
                <div className="binding-field-options">
                  {dataset.columns.map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        disabled={
                          readOnly ||
                          busy ||
                          (!fieldIds.includes(column.id) &&
                            fieldIds.length >= 12)
                        }
                        checked={fieldIds.includes(column.id)}
                        onChange={(e) =>
                          setFieldIds((ids) =>
                            e.target.checked
                              ? [...ids, column.id]
                              : ids.filter((id) => id !== column.id),
                          )
                        }
                      />
                      {column.name}
                    </label>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    disabled={readOnly || busy}
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                  />
                  Подписи полей
                </label>
                <label>
                  Поле статуса
                  <small className="inspector-muted">Значение этого поля задаёт цвет индикатора на объекте. Например: up — зелёный, down — красный. Можно оставить без статуса.</small>
                  <select
                    aria-label="Поле статуса"
                    disabled={readOnly || busy}
                    value={statusColumnId}
                    onChange={(e) => setStatusColumnId(e.target.value)}
                  >
                    <option value="">Без статуса</option>
                    {dataset.columns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                {statusColumnId && (
                  <label>
                    Цвета статусов
                    <input
                      disabled={readOnly || busy}
                      placeholder="up=#22aa55; down=#cc3344"
                      value={statusColors}
                      onChange={(e) => setStatusColors(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {preview && (
              <div className="binding-preview">
                <small>Предпросмотр объекта</small>
                <strong>{preview.title}</strong>
                {preview.subtitle && <span>{preview.subtitle}</span>}
                {preview.fields.map((field) => (
                  <span key={field.id}>
                    {showLabels ? `${field.label}: ` : ''}
                    {field.value}
                  </span>
                ))}
              </div>
            )}

            {selectedDatasetMeta && (
              <p className="inspector-muted">
                Источник: <strong>{selectedDatasetMeta.name}</strong>
                {dataset ? ` · ${dataset.rows.length} строк` : ''}
              </p>
            )}

            {!readOnly && (
              <div className="inspector-actions">
                <button
                  className="primary-button"
                  disabled={
                    !datasetId ||
                    (['ROW', 'CELL'].includes(bindingType) && !rowId) ||
                    (['COLUMN', 'CELL'].includes(bindingType) && !columnId) ||
                    busy
                  }
                  onClick={saveBinding}
                >
                  <Link2 size={14} />
                  {busy
                    ? 'Сохранение…'
                    : existingBinding
                      ? 'Обновить привязку'
                      : bindingType === 'ROW'
                        ? 'Привязать строку к объекту'
                        : 'Привязать данные к объекту'}
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

        {locationDatasetId && (
          <section className="inspector-section">
            <h3>
              <LayoutDashboard size={14} />
              Где показаны данные
            </h3>

            {datasetLocations.filter(
              (location) =>
                location.objectType === 'table' ||
                !existingBinding?.rowId ||
                location.rowId === existingBinding.rowId,
            ).length === 0 ? (
              <p className="inspector-muted">
                TableNode с этим Dataset пока не найден в индексе Board. Индекс
                обновляется при открытии и изменении досок.
              </p>
            ) : (
              <div className="dataset-location-list">
                {datasetLocations
                  .filter(
                    (location) =>
                      location.objectType === 'table' ||
                      !existingBinding?.rowId ||
                      location.rowId === existingBinding.rowId,
                  )
                  .map((location) => {
                    const current =
                      location.boardId === boardId &&
                      location.objectId === node.id;

                    return (
                      <button
                        key={`${location.boardId}:${location.objectId}`}
                        className={current ? 'is-current' : ''}
                        disabled={current && location.objectType !== 'table'}
                        onClick={() =>
                          void navigateToDatasetLocation(
                            location,
                            existingBinding?.rowId,
                          )
                        }
                      >
                        <LayoutDashboard size={13} />
                        <span>
                          <strong>{location.boardName}</strong>
                          <small>
                            {location.objectType === 'table'
                              ? 'Таблица'
                              : 'Представление записи'}
                            {current ? ' · текущий объект' : ''}
                          </small>
                        </span>
                        <ExternalLink size={12} />
                      </button>
                    );
                  })}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
