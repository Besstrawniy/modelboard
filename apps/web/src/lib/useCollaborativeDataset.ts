import { receiveResourceMessage } from './resources';
import { SharedRecordStore, type DatasetView, type DatasetConditionalRule } from '@modelboard/shared';
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
  const ydoc = useMemo(() => new Y.Doc(), [datasetId, token]);
  const metaMap = useMemo(() => ydoc.getMap<any>('meta'), [ydoc]);
  const columnsMap = useMemo(() => new SharedRecordStore(ydoc, 'columns'), [ydoc]);
  const rowsMap = useMemo(() => new SharedRecordStore(ydoc, 'rows'), [ydoc]);
  const formulasMap = useMemo(
    () => ydoc.getMap<DatasetFormula>('formulas'),
    [ydoc],
  );
  const formatsMap = useMemo(
    () => new SharedRecordStore(ydoc, 'formats'),
    [ydoc],
  );
  const viewsMap = useMemo(() => new SharedRecordStore(ydoc,'views'),[ydoc]);
  const rulesMap = useMemo(() => new SharedRecordStore(ydoc,'rules'),[ydoc]);
  const undoManager = useMemo(
    () =>
      new Y.UndoManager(
        [columnsMap.type, rowsMap.type, formulasMap, formatsMap.type, viewsMap.type, rulesMap.type],
        { captureTimeout: 500 },
      ),
    [columnsMap, formatsMap, formulasMap, rowsMap, viewsMap, rulesMap],
  );
  const initialSyncDone = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [storageError,setStorageError]=useState('');
  const [pendingChanges, setPendingChanges] = useState(0);
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
    setStorageError('');

    const collabUrl = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:1234';
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: `dataset:${datasetId}`,
      document: ydoc,
      token,
      flushDelay: 40,
      onStatus: ({ status }) => setStatus(status),
      onAuthenticationFailed: () => { setStatus('error'); setSynced(false); },
      onStateless: ({payload}) => {try{const message=receiveResourceMessage(payload);if(message?.kind==='dataset-deleted'&&message.datasetId===datasetId){setStatus('deleted');setDataset(null);setSynced(false);provider.disconnect();}if(message?.type==='dataset-storage')setStorageError(message.saved?'':message.message);}catch{/* Ignore unrelated stateless messages. */}},
      onUnsyncedChanges: ({ number }) => setPendingChanges(number),
      onSynced: ({ state }) => {
        if (!state) return;
        setSynced(true);

        if (!initialSyncDone.current) {
          undoManager.clear();
          initialSyncDone.current = true;
          setHistoryTick((value) => value + 1);
        }
      },
    });

    const sync = () => {
      const columns = Array.from(columnsMap.values()).sort((a,b) => a.ordinal-b.ordinal || a.id.localeCompare(b.id));
      const rows = Array.from(rowsMap.values()).sort((a,b) => a.ordinal-b.ordinal || a.id.localeCompare(b.id));
      const formulas = Array.from(formulasMap.values());
      const formats = Array.from(formatsMap.values());
      const calculated = evaluateDatasetFormulas(rows,columns,formulas);
      const freshRows = rows.map((row) => {
        const values = {...row.values};
        for(const column of columns) {
          const key=formulaKey(row.id,column.id);
          if(calculated.has(key)) values[column.id]=calculated.get(key) ?? null;
        }
        return {...row,values};
      });
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
        views: Array.from(viewsMap.values()),
        rules: Array.from(rulesMap.values()),
        status,
      });
    };

    let queued=false, disposed=false;
    const scheduleSync=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(!disposed)sync();});};
    metaMap.observe(scheduleSync);
    columnsMap.observe(scheduleSync);
    rowsMap.observe(scheduleSync);
    formulasMap.observe(scheduleSync);
    formatsMap.observe(scheduleSync);
    viewsMap.observe(scheduleSync);
    rulesMap.observe(scheduleSync);
    sync();

    return () => {
      disposed=true;
      metaMap.unobserve(scheduleSync);
      columnsMap.unobserve(scheduleSync);
      rowsMap.unobserve(scheduleSync);
      formulasMap.unobserve(scheduleSync);
      formatsMap.unobserve(scheduleSync);
      viewsMap.unobserve(scheduleSync);
      rulesMap.unobserve(scheduleSync);
      provider.destroy();
      ydoc.destroy();
    };
  }, [
    columnsMap,
    datasetId,
    viewsMap,
    rulesMap,
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

      undoManager.stopCapturing();
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
      undoManager.stopCapturing();
    },
    [formulasMap, readOnly, rowsMap, ydoc],
  );

  const setFormula = useCallback(
    (rowId: string, columnId: string, expression: string) => {
      if (readOnly) return;

      undoManager.stopCapturing();
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
      undoManager.stopCapturing();
      formulasMap.delete(formulaKey(rowId, columnId));
      undoManager.stopCapturing();
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
        format?: Partial<DatasetCellFormat> | null;
      }>,
      addedRows: DatasetRow[] = [],
    ) => {
      if (readOnly || writes.length === 0) return;

      undoManager.stopCapturing();
      ydoc.transact(() => {
        for(const row of addedRows)rowsMap.set(row.id,row);
        for (const write of writes) {
          const row = rowsMap.get(write.rowId);
          if (!row) continue;

          const key = formulaKey(
            write.rowId,
            write.columnId,
          );

          if(write.format!==undefined){if(write.format===null)formatsMap.delete(key);else formatsMap.set(key,{...write.format,rowId:write.rowId,columnId:write.columnId});}
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
      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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
          if (next.numberFormat === null || next.numberFormat === 'GENERAL') {
            delete next.numberFormat;
          }
          if (next.decimalPlaces === null) {
            delete next.decimalPlaces;
          }

          const meaningful =
            Boolean(next.bold) ||
            Boolean(next.italic) ||
            Boolean(next.align) ||
            Boolean(next.background) ||
            Boolean(next.numberFormat) || Boolean(next.color) || Boolean(next.wrap) || Boolean(next.underline) ||
            next.decimalPlaces !== undefined;

          if (meaningful) {
            formatsMap.set(key, next);
          } else {
            formatsMap.delete(key);
          }
        }
      });
      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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
      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
      ydoc.transact(() => {
        columnsMap.delete(columnId);
        for(const [key,formula] of formulasMap.entries())if(formula.columnId===columnId)formulasMap.delete(key);

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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

      undoManager.stopCapturing();
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

  const prepareRows=useCallback(async(rows:Array<{id:string;values?:DatasetRow['values']}>)=>{if(readOnly||!datasetId)return [];return api.createDatasetRows(datasetId,token,rows);},[readOnly,datasetId,token]);
  const reorder = useCallback((kind:'rows'|'columns', id:string, toIndex:number) => {
    if(readOnly)return;
    const map=kind==='rows'?rowsMap:columnsMap;
    const items=Array.from(map.values()).sort((a,b)=>a.ordinal-b.ordinal||a.id.localeCompare(b.id));
    const from=items.findIndex(item=>item.id===id);if(from<0)return;
    const [item]=items.splice(from,1);items.splice(Math.max(0,Math.min(items.length,toIndex)),0,item);
    undoManager.stopCapturing();ydoc.transact(()=>items.forEach((entry,ordinal)=>{if(entry.ordinal!==ordinal)map.set(entry.id,{...entry,ordinal});}));undoManager.stopCapturing();
  },[rowsMap,columnsMap,readOnly,undoManager,ydoc]);
  const saveView=useCallback((view:DatasetView)=>{if(readOnly)return;undoManager.stopCapturing();viewsMap.set(view.id,view);undoManager.stopCapturing();},[viewsMap,readOnly,undoManager]);
  const deleteView=useCallback((id:string)=>{if(readOnly)return;undoManager.stopCapturing();viewsMap.delete(id);undoManager.stopCapturing();},[viewsMap,readOnly,undoManager]);
  const saveRule=useCallback((rule:DatasetConditionalRule)=>{if(readOnly)return;undoManager.stopCapturing();rulesMap.set(rule.id,rule);undoManager.stopCapturing();},[rulesMap,readOnly,undoManager]);
  const deleteRule=useCallback((id:string)=>{if(readOnly)return;undoManager.stopCapturing();rulesMap.delete(id);undoManager.stopCapturing();},[rulesMap,readOnly,undoManager]);
  void historyTick;

  return {
    dataset,
    status,
    pendingChanges,
    storageError,
    synced,
    reorder,saveView,deleteView,saveRule,deleteRule,prepareRows,
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
