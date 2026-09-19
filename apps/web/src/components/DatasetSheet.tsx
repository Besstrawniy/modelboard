import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DatasetCellValue,
  DatasetColumn,
  DatasetRow,
} from '@modelboard/shared';
import { useEffect, useMemo, useState } from 'react';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

const PAGE_SIZE = 200;

type SortState = {
  columnId: string;
  direction: 'asc' | 'desc';
} | null;

function compareValues(a: DatasetCellValue, b: DatasetCellValue) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function normalizeInput(value: string, column: DatasetColumn): DatasetCellValue {
  if (value === '') return null;

  if (column.dataType === 'BOOLEAN') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    return value;
  }

  if (column.dataType === 'INTEGER' && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return value;
}

function SheetCell({
  row,
  column,
  readOnly,
  onChange,
}: {
  row: DatasetRow;
  column: DatasetColumn;
  readOnly: boolean;
  onChange: (value: DatasetCellValue) => void;
}) {
  const raw = row.values[column.id];

  if (column.dataType === 'BOOLEAN') {
    return (
      <select
        className="dataset-sheet__cell-editor"
        disabled={readOnly}
        value={raw === null || raw === undefined ? '' : String(raw)}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value === ''
              ? null
              : value === 'true'
                ? true
                : false,
          );
        }}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      className="dataset-sheet__cell-editor"
      disabled={readOnly}
      value={raw === null || raw === undefined ? '' : String(raw)}
      onChange={(event) =>
        onChange(normalizeInput(event.target.value, column))
      }
    />
  );
}

export function DatasetSheet({
  datasetId,
  token,
  readOnly,
  focusRowId,
  onClose,
}: {
  datasetId: string;
  token: string;
  readOnly: boolean;
  focusRowId?: string;
  onClose: () => void;
}) {
  const {
    dataset,
    status,
    setCell,
    addColumn,
    renameColumn,
    addRow,
    deleteRow,
  } = useCollaborativeDataset(
    datasetId,
    token,
    readOnly,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [rowAction, setRowAction] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');
  const [columnDialog, setColumnDialog] = useState<{
    mode: 'create' | 'rename';
    columnId?: string;
    initialName?: string;
  } | null>(null);
  const [columnName, setColumnName] = useState('');
  const [columnType, setColumnType] =
    useState<DatasetColumn['dataType']>('TEXT');
  const [columnBusy, setColumnBusy] = useState(false);
  const [columnError, setColumnError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setPage(0);
  }, [datasetId, query, sort?.columnId, sort?.direction]);

  useEffect(() => {
    if (!dataset || !focusRowId || query || sort) return;

    const rowIndex = dataset.rows.findIndex(
      (row) => row.id === focusRowId,
    );

    if (rowIndex >= 0) {
      setPage(Math.floor(rowIndex / PAGE_SIZE));
    }
  }, [
    dataset?.id,
    dataset?.rows.length,
    focusRowId,
    query,
    sort?.columnId,
    sort?.direction,
  ]);

  const visibleRows = useMemo(() => {
    if (!dataset) return [];

    const normalizedQuery = query.trim().toLowerCase();

    let result = normalizedQuery
      ? dataset.rows.filter((row) =>
          dataset.columns.some((column) =>
            String(row.values[column.id] ?? '')
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        )
      : [...dataset.rows];

    if (sort) {
      result = result.sort((left, right) => {
        const compared = compareValues(
          left.values[sort.columnId],
          right.values[sort.columnId],
        );
        return sort.direction === 'asc' ? compared : -compared;
      });
    }

    return result;
  }, [dataset, query, sort]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = visibleRows.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const toggleSort = (columnId: string) => {
    setSort((current) => {
      if (!current || current.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { columnId, direction: 'desc' };
      }

      return null;
    });
  };

  return (
    <div className="dataset-sheet">
      {columnDialog && (
        <div className="dataset-sheet__dialog-backdrop">
          <section className="dataset-sheet__column-dialog">
            <header>
              <strong>
                {columnDialog.mode === 'create'
                  ? 'Новая колонка'
                  : 'Переименовать колонку'}
              </strong>
              <button
                className="icon-button"
                onClick={() => setColumnDialog(null)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="dataset-sheet__column-dialog-body">
              <label>
                Название
                <input
                  autoFocus
                  maxLength={120}
                  value={columnName}
                  onChange={(event) =>
                    setColumnName(event.target.value)
                  }
                />
              </label>

              {columnDialog.mode === 'create' && (
                <label>
                  Тип данных
                  <select
                    value={columnType}
                    onChange={(event) =>
                      setColumnType(
                        event.target.value as DatasetColumn['dataType'],
                      )
                    }
                  >
                    <option value="TEXT">TEXT</option>
                    <option value="INTEGER">INTEGER</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="DATE">DATE</option>
                    <option value="UUID">UUID</option>
                  </select>
                </label>
              )}

              {columnError && (
                <div className="dataset-sheet__column-error">
                  {columnError}
                </div>
              )}
            </div>

            <footer>
              <button
                className="secondary-button"
                disabled={columnBusy}
                onClick={() => setColumnDialog(null)}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={columnBusy || !columnName.trim()}
                onClick={async () => {
                  setColumnBusy(true);
                  setColumnError('');
                  try {
                    if (
                      columnDialog.mode === 'rename' &&
                      columnDialog.columnId
                    ) {
                      await renameColumn(
                        columnDialog.columnId,
                        columnName.trim(),
                      );
                    } else {
                      await addColumn(
                        columnName.trim(),
                        columnType,
                      );
                    }
                    setColumnDialog(null);
                  } catch (error) {
                    setColumnError(
                      error instanceof Error
                        ? error.message
                        : String(error),
                    );
                  } finally {
                    setColumnBusy(false);
                  }
                }}
              >
                {columnBusy
                  ? 'Сохранение…'
                  : columnDialog.mode === 'create'
                    ? 'Создать'
                    : 'Сохранить'}
              </button>
            </footer>
          </section>
        </div>
      )}
      <header className="dataset-sheet__topbar">
        <div className="dataset-sheet__identity">
          <span className="dataset-sheet__icon">
            <Database size={18} />
          </span>
          <div>
            <strong>{dataset?.name ?? 'Dataset'}</strong>
            <small>
              {dataset?.kind ?? '—'} · {status}
            </small>
          </div>
        </div>

        <div className="dataset-sheet__stats">
          <span>{dataset?.rows.length ?? 0} строк</span>
          <span>{dataset?.columns.length ?? 0} колонок</span>
          {readOnly && <span>только чтение</span>}
        </div>

        <button
          className="icon-button"
          onClick={onClose}
          title="Закрыть (Esc)"
        >
          <X size={19} />
        </button>
      </header>

      <div className="dataset-sheet__toolbar">
        <label className="dataset-sheet__search">
          <Search size={15} />
          <input
            value={query}
            placeholder="Поиск по всем колонкам…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {!readOnly && (
          <button
            className="dataset-sheet__add-column"
            onClick={() => {
              setColumnDialog({ mode: 'create' });
              setColumnName('');
              setColumnType('TEXT');
              setColumnError('');
            }}
          >
            <Plus size={14} />
            Добавить колонку
          </button>
        )}

        {!readOnly && (
          <button
            className="dataset-sheet__add-row"
            disabled={rowAction === 'add'}
            onClick={async () => {
              setRowAction('add');
              setRowError('');
              try {
                setQuery('');
                setSort(null);
                const nextPage = Math.floor(
                  (dataset?.rows.length ?? 0) / PAGE_SIZE,
                );
                await addRow();
                setPage(nextPage);
              } catch (error) {
                setRowError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setRowAction(null);
              }
            }}
          >
            <Plus size={14} />
            Добавить строку
          </button>
        )}

        <div className="dataset-sheet__page-info">
          Показано {pageRows.length} из {visibleRows.length}
        </div>
      </div>

      <div className="dataset-sheet__viewport">
        {!dataset ? (
          <div className="dataset-sheet__loading">Загрузка Dataset…</div>
        ) : dataset.columns.length === 0 ? (
          <div className="dataset-sheet__loading">В Dataset нет колонок.</div>
        ) : (
          <table className="dataset-sheet__table">
            <thead>
              <tr>
                <th className="dataset-sheet__row-number">#</th>
                {dataset.columns.map((column) => {
                  const activeSort = sort?.columnId === column.id;

                  return (
                    <th key={column.id}>
                      <button
                        className="dataset-sheet__column-header"
                        onClick={() => toggleSort(column.id)}
                      >
                        <span>
                          <strong>
                            {column.name}
                            {!readOnly && (
                              <span
                                className="dataset-sheet__rename-column"
                                role="button"
                                tabIndex={0}
                                title="Переименовать колонку"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setColumnDialog({
                                    mode: 'rename',
                                    columnId: column.id,
                                    initialName: column.name,
                                  });
                                  setColumnName(column.name);
                                  setColumnType(column.dataType);
                                  setColumnError('');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.stopPropagation();
                                    setColumnDialog({
                                      mode: 'rename',
                                      columnId: column.id,
                                      initialName: column.name,
                                    });
                                    setColumnName(column.name);
                                    setColumnType(column.dataType);
                                    setColumnError('');
                                  }
                                }}
                              >
                                <Pencil size={10} />
                              </span>
                            )}
                          </strong>
                          <small>
                            {column.dataType}
                            {column.key ? ` · ${column.key}` : ''}
                          </small>
                        </span>

                        {activeSort ? (
                          sort?.direction === 'asc'
                            ? <ArrowUp size={13} />
                            : <ArrowDown size={13} />
                        ) : (
                          <ArrowUpDown size={13} />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={row.id === focusRowId ? 'is-focused' : ''}
                >
                  <th className="dataset-sheet__row-number">
                    <span>
                      {safePage * PAGE_SIZE + rowIndex + 1}
                    </span>
                    {!readOnly && (
                      <button
                        className="dataset-sheet__delete-row"
                        disabled={rowAction === row.id}
                        onClick={async () => {
                          setRowAction(row.id);
                          setRowError('');
                          try {
                            await deleteRow(row.id);
                          } catch (error) {
                            setRowError(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            );
                          } finally {
                            setRowAction(null);
                          }
                        }}
                        title="Удалить строку"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </th>

                  {dataset.columns.map((column) => (
                    <td key={column.id}>
                      <SheetCell
                        row={row}
                        column={column}
                        readOnly={readOnly}
                        onChange={(value) =>
                          setCell(row.id, column.id, value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}

              {pageRows.length === 0 && (
                <tr>
                  <td
                    className="dataset-sheet__empty"
                    colSpan={dataset.columns.length + 1}
                  >
                    По запросу ничего не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {rowError && (
        <div className="dataset-sheet__error">
          {rowError}
        </div>
      )}

      <footer className="dataset-sheet__footer">
        <div>
          Страница {safePage + 1} из {totalPages}
        </div>

        <div className="dataset-sheet__pagination">
          <button
            disabled={safePage <= 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft size={15} />
            Назад
          </button>
          <button
            disabled={safePage >= totalPages - 1}
            onClick={() =>
              setPage((value) => Math.min(totalPages - 1, value + 1))
            }
          >
            Далее
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}
