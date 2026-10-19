import { useState } from 'react';
import type { DatasetSnapshot } from '@modelboard/shared';
import { exportDatasetFile } from '../lib/fileFormats';
export function DatasetExport({ dataset }: { dataset: DatasetSnapshot }) {
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'tsv' | 'json'>('xlsx'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <span className="dataset-export">
      <select
        aria-label="Формат экспорта таблицы"
        value={format}
        onChange={(e) => setFormat(e.target.value as typeof format)}
      >
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="csv">CSV</option>
        <option value="tsv">TSV</option>
        <option value="json">JSON с форматами и формулами</option>
      </select>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await exportDatasetFile(dataset, format);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Экспорт…' : 'Экспорт таблицы'}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
