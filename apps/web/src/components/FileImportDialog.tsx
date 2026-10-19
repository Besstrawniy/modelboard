import { useMemo, useState } from 'react';
import { api, type StoredFile } from '../lib/api';
import { buildImportedSheet, type ParsedFiles } from '../lib/fileFormats';
export type ImportedFilesResult = {
  datasets: Array<{ id: string; name: string }>;
  files: StoredFile[];
};
export function FileImportDialog({
  parsed,
  token,
  workspaceId,
  onCancel,
  onImported,
  onBoardImported,
}: {
  parsed: ParsedFiles;
  token: string;
  workspaceId: string;
  onCancel: () => void;
  onImported: (result: ImportedFilesResult, parsed: ParsedFiles) => void;
  onBoardImported: (id: string) => void | Promise<void>;
}) {
  const [header, setHeader] = useState<Record<string, boolean>>({}),
    [names, setNames] = useState<Record<string, string>>({}),
    [excluded, setExcluded] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const drafts = useMemo(
    () =>
      parsed.sheets.map((sheet) => {
        try {
          return {
            sheet,
            dataset: buildImportedSheet(sheet, header[sheet.id] !== false),
            error: '',
          };
        } catch (e) {
          return { sheet, dataset: null, error: (e as Error).message };
        }
      }),
    [parsed, header],
  );
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (parsed.archive) {
        const result = await api.importBoard(
          workspaceId,
          token,
          parsed.archive,
        );
        await onBoardImported(result.id);
        return;
      }
      const selected = drafts.filter((d) => !excluded.includes(d.sheet.id));
      const invalid = selected.find((d) => d.error);
      if (invalid) throw new Error(invalid.error);
      const datasets = selected.map((d) => ({
        ...d.dataset!,
        name: (names[d.sheet.id] ?? d.sheet.name).trim(),
      }));
      if (datasets.some((d) => !d.name || d.name.length > 120))
        throw new Error('Название таблицы — от 1 до 120 символов');
      const result = await api.importFiles(workspaceId, token, {
        datasets,
        files: parsed.images,
      });
      onImported(result, parsed);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="file-modal-backdrop" onKeyDown={(e) => e.stopPropagation()}>
      <section
        className="file-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Импорт файлов"
      >
        <header>
          <h2>Импорт файлов</h2>
          <button disabled={busy} onClick={onCancel}>
            Отмена
          </button>
        </header>
        <div className="file-dialog__body">
          {parsed.archive ? (
            <>
              <h3>Доска: {parsed.archive.name}</h3>
              <p>
                {parsed.archive.nodes.length} объектов ·{' '}
                {parsed.archive.datasets.length} таблиц ·{' '}
                {parsed.archive.relations.length} связей ·{' '}
                {parsed.archive.files.length} изображений
              </p>
              <p>
                Будет создана отдельная доска с копиями данных и сохранёнными
                привязками.
              </p>
            </>
          ) : (
            <>
              {drafts.map(({ sheet, dataset, error: sheetError }) => (
                <article className="file-sheet-preview" key={sheet.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!excluded.includes(sheet.id)}
                      onChange={(e) =>
                        setExcluded(
                          e.target.checked
                            ? excluded.filter((id) => id !== sheet.id)
                            : [...excluded, sheet.id],
                        )
                      }
                    />{' '}
                    Импортировать лист «{sheet.name}»
                  </label>
                  <label>
                    Название таблицы
                    <input
                      aria-label={`Название таблицы ${sheet.name}`}
                      maxLength={120}
                      value={names[sheet.id] ?? sheet.name}
                      onChange={(e) =>
                        setNames({ ...names, [sheet.id]: e.target.value })
                      }
                    />
                  </label>
                  {!sheet.native && (
                    <label>
                      <input
                        type="checkbox"
                        checked={header[sheet.id] !== false}
                        onChange={(e) =>
                          setHeader({ ...header, [sheet.id]: e.target.checked })
                        }
                      />{' '}
                      Первая строка — заголовки
                    </label>
                  )}
                  {dataset && (
                    <>
                      <p>
                        {dataset.rows.length} строк · {dataset.columns.length}{' '}
                        колонок · {dataset.formulas.length} формул
                      </p>
                      <div className="file-preview-table">
                        <table>
                          <thead>
                            <tr>
                              {dataset.columns.slice(0, 12).map((c) => (
                                <th key={c.id}>
                                  {c.name}
                                  <small>{c.dataType}</small>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dataset.rows.slice(0, 5).map((r) => (
                              <tr key={r.id}>
                                {dataset.columns.slice(0, 12).map((c) => (
                                  <td key={c.id}>
                                    {String(r.values[c.id] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {sheet.warnings.map((w) => (
                    <p className="file-note" key={w}>
                      {w}
                    </p>
                  ))}
                  {sheetError && <p role="alert">{sheetError}</p>}
                </article>
              ))}
              {parsed.images.map((image, i) => (
                <article className="file-image-preview" key={i}>
                  <img
                    src={`data:${image.mime};base64,${image.base64}`}
                    alt={image.name}
                  />
                  <div>
                    <strong>{image.name}</strong>
                    <p>
                      {image.width} × {image.height}
                    </p>
                  </div>
                </article>
              ))}
            </>
          )}
          {error && (
            <p role="alert" className="inspector-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span>До подтверждения файлы не сохраняются.</span>
          <button
            className="primary-button"
            disabled={
              busy ||
              (!parsed.archive &&
                !parsed.images.length &&
                drafts.every((d) => excluded.includes(d.sheet.id)))
            }
            onClick={submit}
          >
            {busy
              ? 'Импорт…'
              : parsed.archive
                ? 'Создать доску из архива'
                : 'Создать таблицы и добавить файлы'}
          </button>
        </footer>
      </section>
    </div>
  );
}
