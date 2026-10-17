import { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  DatasetColumn,
  DatasetCellFormat,
  DatasetCellValue,
  DatasetFormula,
  DatasetKind,
  DatasetRow,
  DatasetSnapshot,
} from '@modelboard/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { api } from './api';
import {
  evaluateDatasetFormulas,
  formulaKey,
} from './formulas';

type DatasetState = DatasetSnapshot & {
  status: string;
};

export function useCollaborativeDataset(
  datasetId: string | undefined,
  token: string,
  readOnly: boolean,
) {
  const ydoc = useMemo(() => new Y.Doc(), [datasetId]);
  const metaMap = useMemo(() => ydoc.getMap<any>('meta'), [ydoc]);
  const columnsMap = useMemo(() => ydoc.getMap<DatasetColumn>('columns'), [ydoc]);
  const rowsMap = useMemo(() => ydoc.getMap<DatasetRow>('rows'), [ydoc]);
  const formulasMap = useMemo(
    () => ydoc.getMap<DatasetFormula>('formulas'),
    [ydoc],
  );
  const formatsMap = useMemo(
    () => ydoc.getMap<DatasetCellFormat>('formats'),
    [ydoc],
  );
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [columnsMap, rowsMap, formulasMap, formatsMap],
        { captureTimeout: 500 },
      ),
    [columnsMap, formatsMap, formulasMap, rowsMap],
  );
  const initialSyncDone = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [synced, setSynced] = useState(false);
  const [dataset, setDataset] = useState<DatasetState | null>(null);

  useEffect(() => {
    initialSyncDone.current = false;
  }, [ydoc]);

  useEffect(() => {
    if (!datasetId || !token) {
      setDataset(null);
      setStatus('idle');
      setSynced(false);
      return;
    }

    setDataset(null);
    setStatus('connecting');
    setSynced(false);

    const collabUrl = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:1234';
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: `dataset:${datasetId}`,
      document: ydoc,
      token,
      flushDelay: 40,
      onStatus: ({ status }) => setStatus(status),
      onSynced: () => {
        setSynced(true);

        if (!initialSyncDone.current) {
          undoManager.clear();
          initialSyncDone.current = true;
          setHistoryTick((value) => value + 1);
        }
      },
    });

    let recalculating = false;

    const sync = () => {
      const columns = Array.from(columnsMap.values()).sort(
        (a, b) => a.ordinal - b.ordinal,
      );
      const rows = Array.from(rowsMap.values()).sort(
        (a, b) => a.ordinal - b.ordinal,
      );
      const formulas = Array.from(formulasMap.values());
      const formats = Array.from(formatsMap.values());

      if (!recalculating && formulas.length > 0) {
        recalculating = true;
        const calculated = evaluateDatasetFormulas(
          rows,
          columns,
          formulas,
        );

        const updates: Array<{
          row: DatasetRow;
          columnId: string;
          value: DatasetCellValue;
        }> = [];

        for (const formula of formulas) {
          const key = formulaKey(
            formula.rowId,
            formula.columnId,
          );
          const value = calculated.get(key) ?? null;
          const row = rowsMap.get(formula.rowId);

          if (
            row &&
            row.values[formula.columnId] !== value
          ) {
            updates.push({
              row,
              columnId: formula.columnId,
              value,
            });
          }
        }

        if (updates.length > 0) {
          ydoc.transact(() => {
            for (const update of updates) {
              rowsMap.set(update.row.id, {
                ...update.row,
                values: {
                  ...update.row.values,
                  [update.columnId]: update.value,
                },
              });
            }
          });
        }

        recalculating = false;
      }

      const freshRows = Array.from(rowsMap.values()).sort(
        (a, b) => a.ordinal - b.ordinal,
      );

      const id = String(metaMap.get('id') ?? datasetId);
      const workspaceId = String(metaMap.get('workspaceId') ?? '');
      const name = String(metaMap.get('name') ?? 'Loading dataset…');
      const kind = String(metaMap.get('kind') ?? 'MANUAL') as DatasetKind;

      setDataset({
        id,
        workspaceId,
        name,
        kind,
        columns,
        rows: freshRows,
        formulas,
        formats,
        status,
      });
    };

    metaMap.observe(sync);
    columnsMap.observe(sync);
    rowsMap.observe(sync);
    formulasMap.observe(sync);
    formatsMap.observe(sync);
    sync();

    return () => {
      metaMap.unobserve(sync);
      columnsMap.unobserve(sync);
      rowsMap.unobserve(sync);
      formulasMap.unobserve(sync);
      formatsMap.unobserve(sync);
      provider.destroy();
      ydoc.destroy();
    };
  }, [
    columnsMap,
    datasetId,
    formatsMap,
    formulasMap,
    metaMap,
    rowsMap,
    token,
    undoManager,
    ydoc,
  ]);

  useEffect(() => {
    const refreshHistory = () =>
      setHistoryTick((value) => value + 1);

    undoManager.on('stack-item-added', refreshHistory);
    undoManager.on('stack-item-popped', refreshHistory);
    undoManager.on('stack-cleared', refreshHistory);
    undoManager.on('stack-item-updated', refreshHistory);

    return () => {
      undoManager.off('stack-item-added', refreshHistory);
      undoManager.off('stack-item-popped', refreshHistory);
      undoManager.off('stack-cleared', refreshHistory);
      undoManager.off('stack-item-updated', refreshHistory);
    };
  }, [undoManager]);

  useEffect(() => {
    setDataset((current) => (current ? { ...current, status } : current));
  }, [status]);

  const setCell = useCallback(
    (
      rowId: string,
      columnId: string,
      value: string | number | boolean | null,
    ) => {
      if (readOnly) return;
      const row = rowsMap.get(rowId);
      if (!row) return;

      ydoc.transact(() => {
        formulasMap.delete(formulaKey(rowId, columnId));
        rowsMap.set(rowId, {
          ...row,
          values: {
            ...row.values,
            [columnId]: value,
          },
        });
      });
    },
    [formulasMap, readOnly, rowsMap, ydoc],
  );

  const setFormula = useCallback(
    (rowId: string, columnId: string, expression: string) => {
      if (readOnly) return;

      formulasMap.set(
        formulaKey(rowId, columnId),
        {
          rowId,
          columnId,
          expression,
        },
      );
    },
    [formulasMap, readOnly],
  );

  const clearFormula = useCallback(
    (rowId: string, columnId: string) => {
      if (readOnly) return;
      formulasMap.delete(formulaKey(rowId, columnId));
    },
    [formulasMap, readOnly],
  );

  const applyCellBatch = useCallback(
    (
      writes: Array<{
        rowId: string;
        columnId: string;
        value?: DatasetCellValue;
        formulaExpression?: string | null;
      }>,
    ) => {
      if (readOnly || writes.length === 0) return;

      ydoc.transact(() => {
        for (const write of writes) {
          const row = rowsMap.get(write.rowId);
          if (!row) continue;

          const key = formulaKey(
            write.rowId,
            write.columnId,
          );

          if (write.formulaExpression !== undefined) {
            if (write.formulaExpression === null) {
              formulasMap.delete(key);
            } else {
              formulasMap.set(key, {
                rowId: write.rowId,
                columnId: write.columnId,
                expression: write.formulaExpression,
              });
            }
          }

          if (write.value !== undefined) {
            rowsMap.set(write.rowId, {
              ...row,
              values: {
                ...row.values,
                [write.columnId]: write.value,
              },
            });
          }
        }
      });
    },
    [formulasMap, readOnly, rowsMap, ydoc],
  );

  const applyFormatBatch = useCallback(
    (
      cells: Array<{
        rowId: string;
        columnId: string;
      }>,
      patch: Partial<
        Omit<DatasetCellFormat, 'rowId' | 'columnId'>
      >,
    ) => {
      if (readOnly || cells.length === 0) return;

      ydoc.transact(() => {
        for (const cell of cells) {
          const key = formulaKey(
            cell.rowId,
            cell.columnId,
          );
          const current = formatsMap.get(key);

          const next: DatasetCellFormat = {
            rowId: cell.rowId,
            columnId: cell.columnId,
            ...(current ?? {}),
            ...patch,
          };

          if (next.align === null) {
            delete next.align;
          }
          if (next.background === null) {
            delete next.background;
          }

          const meaningful =
            Boolean(next.bold) ||
            Boolean(next.italic) ||
            Boolean(next.align) ||
            Boolean(next.background);

          if (meaningful) {
            formatsMap.set(key, next);
          } else {
            formatsMap.delete(key);
          }
        }
      });
    },
    [formatsMap, readOnly, ydoc],
  );

  const addColumn = useCallback(
    async (
      name: string,
      dataType: DatasetColumn['dataType'] = 'TEXT',
      afterColumnId?: string,
    ) => {
      if (readOnly || !datasetId || !token) return null;

      const column = await api.createDatasetColumn(
        datasetId,
        token,
        {
          name,
          dataType,
          ...(afterColumnId ? { afterColumnId } : {}),
        },
      );

      ydoc.transact(() => {
        for (const [id, current] of columnsMap.entries()) {
          if (current.ordinal >= column.ordinal) {
            columnsMap.set(id, {
              ...current,
              ordinal: current.ordinal + 1,
            });
          }
        }
        columnsMap.set(column.id, column);
      });

      return column;
    },
    [
      columnsMap,
      datasetId,
      formatsMap,
      readOnly,
      token,
      ydoc,
    ],
  );

  const renameColumn = useCallback(
    async (columnId: string, name: string) => {
      if (readOnly || !datasetId || !token) return null;

      const column = await api.renameDatasetColumn(
        datasetId,
        columnId,
        token,
        name,
      );
      columnsMap.set(column.id, column);
      return column;
    },
    [columnsMap, datasetId, readOnly, token],
  );

  const convertColumn = useCallback(
    async (
      columnId: string,
      dataType: DatasetColumn['dataType'],
      values: Record<string, DatasetCellValue>,
    ) => {
      if (readOnly || !datasetId || !token) return null;

      const result = await api.convertDatasetColumn(
        datasetId,
        columnId,
        token,
        { dataType, values },
      );

      ydoc.transact(() => {
        columnsMap.set(result.column.id, result.column);

        for (const [rowId, value] of Object.entries(result.values)) {
          const row = rowsMap.get(rowId);
          if (!row) continue;
          rowsMap.set(rowId, {
            ...row,
            values: {
              ...row.values,
              [columnId]: value,
            },
          });
        }
      });

      return result;
    },
    [
      columnsMap,
      datasetId,
      readOnly,
      rowsMap,
      token,
      ydoc,
    ],
  );

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (readOnly || !datasetId || !token) return false;

      await api.deleteDatasetColumn(
        datasetId,
        columnId,
        token,
      );

      ydoc.transact(() => {
        columnsMap.delete(columnId);

        for (const [key, format] of formatsMap.entries()) {
          if (format.columnId === columnId) {
            formatsMap.delete(key);
          }
        }

        for (const [rowId, row] of rowsMap.entries()) {
          if (!(columnId in row.values)) continue;
          const values = { ...row.values };
          delete values[columnId];
          rowsMap.set(rowId, {
            ...row,
            values,
          });
        }
      });

      return true;
    },
    [
      columnsMap,
      datasetId,
      readOnly,
      rowsMap,
      token,
      ydoc,
    ],
  );

  const addRow = useCallback(
    async (
      values: DatasetRow['values'] = {},
      afterRowId?: string,
    ) => {
      if (readOnly || !datasetId || !token) return null;

      const row = await api.createDatasetRow(
        datasetId,
        token,
        values,
        afterRowId,
      );

      ydoc.transact(() => {
        for (const [id, current] of rowsMap.entries()) {
          if (current.ordinal >= row.ordinal) {
            rowsMap.set(id, {
              ...current,
              ordinal: current.ordinal + 1,
            });
          }
        }
        rowsMap.set(row.id, row);
      });

      return row;
    },
    [
      datasetId,
      readOnly,
      rowsMap,
      token,
      ydoc,
    ],
  );

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (readOnly || !datasetId || !token) return false;

      await api.deleteDatasetRow(datasetId, rowId, token);

      ydoc.transact(() => {
        rowsMap.delete(rowId);

        for (const [key, formula] of formulasMap.entries()) {
          if (formula.rowId === rowId) {
            formulasMap.delete(key);
          }
        }

        for (const [key, format] of formatsMap.entries()) {
          if (format.rowId === rowId) {
            formatsMap.delete(key);
          }
        }
      });

      return true;
    },
    [
      datasetId,
      formatsMap,
      formulasMap,
      readOnly,
      rowsMap,
      token,
      ydoc,
    ],
  );

  void historyTick;

  return {
    dataset,
    status,
    synced,
    canUndo: undoManager.undoStack.length > 0,
    canRedo: undoManager.redoStack.length > 0,
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    setCell,
    setFormula,
    clearFormula,
    applyCellBatch,
    applyFormatBatch,
    addColumn,
    renameColumn,
    convertColumn,
    deleteColumn,
    addRow,
    deleteRow,
  };
}
