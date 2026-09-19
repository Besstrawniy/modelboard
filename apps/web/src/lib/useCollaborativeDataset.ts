import { HocuspocusProvider } from '@hocuspocus/provider';
import type {
  DatasetColumn,
  DatasetKind,
  DatasetRow,
  DatasetSnapshot,
} from '@modelboard/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';

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

  return {
    dataset,
    status,
    setCell,
  };
}
