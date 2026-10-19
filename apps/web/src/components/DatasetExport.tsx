import { Download } from 'lucide-react';
import { useState } from 'react';
import type { DatasetSnapshot } from '@modelboard/shared';
import { exportDatasetFile } from '../lib/fileFormats';
export function DatasetExport({ dataset }: { dataset: DatasetSnapshot }) {
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'tsv' | 'json'>('xlsx'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [open,setOpen]=useState(false);
  return (
    <span className="dataset-export">
      <button title="Экспорт таблицы" aria-label="Экспорт таблицы" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Download size={16}/></button>
      {open&&<span className="dataset-export__menu"><select
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
        {busy ? 'Экспорт…' : 'Скачать файл'}
      </button>
      </span>}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
