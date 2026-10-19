import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { DatasetSnapshot } from '@modelboard/shared';
import { evaluateDatasetFormulas } from './formulas';
/** Read the current shared state, including changes not yet projected to SQL. */
export async function readDatasetSnapshot(
  id: string,
  token: string,
): Promise<DatasetSnapshot> {
  const doc = new Y.Doc();
  let provider: HocuspocusProvider | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error('Не удалось синхронизировать таблицу для экспорта')),
        15000,
      );
      provider = new HocuspocusProvider({
        url: import.meta.env.VITE_COLLAB_URL ?? 'ws://localhost:1234',
        name: `dataset:${id}`,
        document: doc,
        token,
        onSynced: ({ state }) => {
          if (state) {
            clearTimeout(timer);
            resolve();
          }
        },
        onAuthenticationFailed: () => {
          clearTimeout(timer);
          reject(new Error('Нет доступа к таблице архива'));
        },
      });
    });
    const list = (name: string) =>
      Array.from(doc.getMap(name).values()).map((item: any) =>
        item instanceof Y.Map ? item.toJSON() : item,
      );
    const columns = list('columns').sort(
        (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
      ),
      rows = list('rows').sort(
        (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
      ),
      formulas = list('formulas'),
      calculated = evaluateDatasetFormulas(rows, columns, formulas);
    for (const row of rows)
      for (const column of columns) {
        const key = `${row.id}:${column.id}`;
        if (calculated.has(key))
          row.values[column.id] = calculated.get(key) ?? null;
      }
    return {
      ...doc.getMap('meta').toJSON(),
      id,
      columns,
      rows,
      formulas,
      formats: list('formats'),
      views: list('views'),
      rules: list('rules'),
    } as DatasetSnapshot;
  } finally {
    provider?.destroy();
    doc.destroy();
  }
}
