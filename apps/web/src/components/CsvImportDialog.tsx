import { useDialogFocus } from '../lib/useDialogFocus';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CreateDatasetInput } from '@modelboard/shared';
import {
  buildCsvImportDraft,
  csvDefaultName,
  toCreateDatasetInput,
  type ParsedCsv,
} from '../lib/csv';

export function CsvImportDialog({
  parsed,
  onCancel,
  onImport,
}: {
  parsed: ParsedCsv;
  onCancel: () => void;
  onImport: (input: CreateDatasetInput) => Promise<void>;
}) {
  const [name, setName] = useState(csvDefaultName(parsed.fileName));
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const draft = useMemo(
    () => buildCsvImportDraft(parsed, firstRowIsHeader),
    [parsed, firstRowIsHeader],
  );

  const dialog = useDialogFocus({ onClose: () => { if (!busy) onCancel(); } });
  const submit = async () => {
    if (!name.trim()) return;

    setBusy(true);
    setError('');

    try {
      await onImport(toCreateDatasetInput(name.trim(), draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section {...dialog} className="csv-dialog" role="dialog" aria-modal="true" aria-label="Импорт CSV">
        <header className="csv-dialog__header">
          <div>
            <span className="csv-dialog__icon"><FileSpreadsheet size={20} /></span>
            <div>
              <strong>Import CSV as Dataset</strong>
              <small>{parsed.fileName}</small>
            </div>
          </div>
          <button className="icon-button" aria-label="Отменить импорт" onClick={onCancel} disabled={busy}>
            <X size={18} />
          </button>
        </header>

        <div className="csv-dialog__body">
          <div className="csv-dialog__summary">
            <label>
              Dataset name
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className="csv-checkbox">
              <input
                type="checkbox"
                checked={firstRowIsHeader}
                onChange={(event) => setFirstRowIsHeader(event.target.checked)}
              />
              First row contains column names
            </label>

            <div className="csv-facts">
              <span><strong>{draft.rows.length}</strong> rows</span>
              <span><strong>{draft.columns.length}</strong> columns</span>
              <span>delimiter <code>{parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter}</code></span>
              <span>{Math.ceil(parsed.fileSize / 1024)} KB</span>
            </div>
          </div>

          <div className="csv-preview-wrap">
            <table className="csv-preview">
              <thead>
                <tr>
                  {draft.columns.map((column) => (
                    <th key={column.id}>
                      <span>{column.name}</span>
                      <small>{column.dataType}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.preview.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {draft.columns.map((column, columnIndex) => (
                      <td key={column.id}>{row[columnIndex] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="csv-dialog__note">
            Types are inferred from the first 200 non-empty values in each column.
            Empty cells are stored as null. You can edit the imported table immediately after creation.
          </p>

          {error && <div className="csv-dialog__error">{error}</div>}
        </div>

        <footer className="csv-dialog__footer">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" onClick={submit} disabled={busy || !name.trim()}>
            <Upload size={16} />
            {busy ? 'Importing…' : 'Create dataset'}
          </button>
        </footer>
      </section>
    </div>
  );
}
