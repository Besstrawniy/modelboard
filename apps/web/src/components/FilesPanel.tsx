import { useEffect, useRef, useState } from 'react';
import { validateBoardArchive, type BoardArchive } from '@modelboard/shared';
import { api, type StoredFile } from '../lib/api';
import { FILE_ACCEPT, downloadFile } from '../lib/fileFormats';
import { readDatasetSnapshot } from '../lib/readDatasetSnapshot';
export function FilesPanel({
  workspaceId,
  boardId,
  token,
  readOnly,
  connected,
  getState,
  onChoose,
  onPlace,
  onImageExport,
  onClose,
}: {
  workspaceId: string;
  boardId: string;
  token: string;
  readOnly: boolean;
  connected: boolean;
  getState: () => { nodes: any[]; edges: any[]; strokes: any[] };
  onChoose: (files: File[]) => void;
  onPlace: (file: StoredFile) => void;
  onImageExport: (format: 'png' | 'svg') => Promise<void>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<StoredFile[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api
      .files(workspaceId, token)
      .then(setFiles)
      .catch((e) => setError(e.message));
  }, [workspaceId, token]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const backup = () =>
    run(async () => {
      const archive = await api.exportBoard(boardId, token, getState());
      archive.datasets = await Promise.all(
        archive.datasets.map((ds) => readDatasetSnapshot(ds.id, token)),
      );
      validateBoardArchive(archive);
      downloadFile(`${archive.name}.modelboard.json`, JSON.stringify(archive));
      setMessage('Архив сохранён: объекты, таблицы, связи и изображения.');
    });
  return (
    <aside className="files-panel">
      <header>
        <h3>Файлы</h3>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Закрыть файлы"
        >
          ×
        </button>
      </header>
      <div className="files-panel__body">
        <input
          ref={input}
          className="file-input"
          type="file"
          multiple
          accept={FILE_ACCEPT}
          aria-label="Выбрать файлы для импорта"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (chosen.length) onChoose(chosen);
          }}
        />
        <button
          disabled={readOnly || busy}
          onClick={() => input.current?.click()}
        >
          Импорт файлов
        </button>
        <p>
          Перенесите CSV, TSV, XLSX или JSON на доску — листы станут таблицами
          после предпросмотра. PNG, JPEG, WebP и SVG добавляются как
          изображения.
        </p>
        <p>
          Таблицы: до 10 000 строк × 100 колонок. Один файл до 10 МБ;
          изображение до 3 МБ; архив до 30 МБ.
        </p>
        <h4>Экспорт доски</h4>
        <button disabled={busy || !connected} onClick={backup}>
          Скачать архив доски JSON
        </button>
        <p>
          Архив включает исходные данные, формулы, связи, изображения и
          используемые SVG-шаблоны. Импорт создаёт отдельную доску. Комментарии
          и история участников в архив не входят.
        </p>
        <div>
          <button
            disabled={busy || !connected}
            onClick={() => void run(() => onImageExport('png'))}
          >
            Экспорт PNG
          </button>
          <button
            disabled={busy || !connected}
            onClick={() => void run(() => onImageExport('svg'))}
          >
            Экспорт SVG
          </button>
        </div>
        <p>
          PNG/SVG — снимок представлений; редактируемая структура сохраняется в
          JSON. Таблицы экспортируются из своего редактора в XLSX, CSV, TSV или
          JSON.
        </p>
        <h4>Изображения Workspace</h4>
        {files.length === 0 ? (
          <p>Пока нет файлов.</p>
        ) : (
          files.map((file) => (
            <article className="file-library-item" key={file.id}>
              <strong>{file.name}</strong>
              <small>
                {Math.ceil(file.size / 1024)} КБ · {file.mime}
              </small>
              <button disabled={readOnly || busy} onClick={() => onPlace(file)}>
                На доску
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    downloadFile(file.name, await api.fileBlob(file.id, token)),
                  )
                }
              >
                Скачать файл
              </button>
              {file.mime === 'image/svg+xml' && !readOnly && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const blob = await api.fileBlob(file.id, token);
                      await api.createTemplate(workspaceId, token, {
                        name: file.name.replace(/\.svg$/i, ''),
                        svg: await blob.text(),
                        defaultWidth: 220,
                        defaultHeight: 130,
                      });
                      setMessage(
                        'SVG добавлен в библиотеку инфраструктурных шаблонов.',
                      );
                      window.dispatchEvent(new Event('modelboard:templates'));
                    })
                  }
                >
                  В библиотеку SVG
                </button>
              )}
            </article>
          ))
        )}
        {busy && <p role="status">Обработка файла…</p>}
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="inspector-error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
