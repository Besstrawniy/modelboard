import { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  DatasetColumn,
  DatasetKind,
  DatasetRow,
  DatasetSnapshot,
} from '@modelboard/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { api } from './api';

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
  const [status, setStatus] = useState('connecting');
  const [dataset, setDataset] = useState<DatasetState | null>(null);

  useEffect(() => {
    if (!datasetId || !token) {
      setDataset(null);
      setStatus('idle');
      return;
    }

    const collabUrl = import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:1234';
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: `dataset:${datasetId}`,
      document: ydoc,
      token,
      flushDelay: 40,
      onStatus: ({ status }) => setStatus(status),
    });

    const sync = () => {
      const columns = Array.from(columnsMap.values()).sort(
        (a, b) => a.ordinal - b.ordinal,
      );
      const rows = Array.from(rowsMap.values()).sort(
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
        rows,
        status,
      });
    };

    metaMap.observe(sync);
    columnsMap.observe(sync);
    rowsMap.observe(sync);
    sync();

    return () => {
      metaMap.unobserve(sync);
      columnsMap.unobserve(sync);
      rowsMap.unobserve(sync);
      provider.destroy();
      ydoc.destroy();
    };
  }, [columnsMap, datasetId, metaMap, rowsMap, token, ydoc]);

  useEffect(() => {
    setDataset((current) => (current ? { ...current, status } : current));
  }, [status]);

  const setCell = useCallback(
    (rowId: string, columnId: string, value: string | number | boolean | null) => {
      if (readOnly) return;
      const row = rowsMap.get(rowId);
      if (!row) return;

      rowsMap.set(rowId, {
        ...row,
        values: {
          ...row.values,
          [columnId]: value,
        },
      });
    },
    [readOnly, rowsMap],
  );

  const addColumn = useCallback(
    async (
      name: string,
      dataType: DatasetColumn['dataType'] = 'TEXT',
    ) => {
      if (readOnly || !datasetId || !token) return null;

      const column = await api.createDatasetColumn(
        datasetId,
        token,
        { name, dataType },
      );
      columnsMap.set(column.id, column);
      return column;
    },
    [columnsMap, datasetId, readOnly, token],
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
    async (values: DatasetRow['values'] = {}) => {
      if (readOnly || !datasetId || !token) return null;

      const row = await api.createDatasetRow(
        datasetId,
        token,
        values,
      );
      rowsMap.set(row.id, row);
      return row;
    },
    [datasetId, readOnly, rowsMap, token],
  );

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (readOnly || !datasetId || !token) return false;

      await api.deleteDatasetRow(datasetId, rowId, token);
      rowsMap.delete(rowId);
      return true;
    },
    [datasetId, readOnly, rowsMap, token],
  );

  return {
    dataset,
    status,
    setCell,
    addColumn,
    renameColumn,
    deleteColumn,
    addRow,
    deleteRow,
  };
}
