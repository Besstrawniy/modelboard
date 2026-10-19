import { useBoardActions } from './BoardContext';
import { DatasetRename } from './DatasetRename';
import { RelationManager } from './RelationManager';
import { Database, Plus, Table2, Trash2, X, Network, Pencil, LayoutPanelTop } from 'lucide-react';
import type { DatasetMeta } from '@modelboard/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function DatasetsPanel({
  workspaceId,
  token,
  readOnly,
  onPlace,
  onClose,
}: {
  workspaceId: string;
  token: string;
  readOnly: boolean;
  onPlace: (datasetId: string) => void;
  onClose: () => void;
}) {
  const { openDatasetSheet } = useBoardActions();
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [tab, setTab] = useState<'datasets' | 'relations'>('datasets');
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
    rows: number;
    bindings: number;
    relations: number;
    views: number;
  } | null>(null);

  const load = async () => {
    setDatasets(await api.datasets(workspaceId, token));
  };

  useEffect(() => {
    void load().catch((err) => setError(err.message));
    const refresh = () => void load().catch((err) => setError(err.message));
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [workspaceId, token]);

  const create = async () => {
    if (readOnly) return;
    setBusy(true);
    try {
      const next = await api.createDataset(workspaceId, token, {
        name: `dataset_${datasets.length + 1}`,
        kind: 'MANUAL',
      });
      await load();
      onPlace(next.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="datasets-panel">
      <header>
        <div>
          <Database size={18} /> Datasets
        </div>
        <button className="icon-button" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <nav className="datasets-panel__tabs">
        <button
          title="Таблицы" aria-label="Таблицы" aria-pressed={tab === 'datasets'}
          onClick={() => setTab('datasets')}
        >
          <Table2 size={18}/>
        </button>
        <button
          title="Связи" aria-label="Связи" aria-pressed={tab === 'relations'}
          onClick={() => setTab('relations')}
        >
          <Network size={18}/>
        </button>
      </nav>
      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'relations' ? (
        <RelationManager datasets={datasets} />
      ) : (
        <>
          <div className="datasets-panel__actions">
            <button disabled={readOnly || busy} onClick={create}>
              <Plus size={16} /> New dataset
            </button>
          </div>

          <div className="datasets-panel__list">
            {datasets.map((dataset) => (
              <article key={dataset.id} className="dataset-card">
                <div className="dataset-card__icon">
                  <Table2 size={17} />
                </div>
                <div className="dataset-card__meta">
                  <strong>{dataset.name}</strong><DatasetRename id={dataset.id} name={dataset.name} token={token} readOnly={readOnly} onSaved={()=>void load()}/>
                  <small>{dataset.kind}</small>
                </div>
                <button
                  disabled={readOnly}
                  onClick={() => onPlace(dataset.id)}
                  title="Разместить таблицу на доске" aria-label="Разместить таблицу на доске"
                >
                  <LayoutPanelTop size={16}/>
                </button>
                <button title="Редактировать таблицу" aria-label="Редактировать таблицу" onClick={() => openDatasetSheet(dataset.id)}><Pencil size={16}/></button>
                {!readOnly && (
                  <button
                    title="Удалить Dataset"
                    disabled={busy}
                    onClick={async () => {
                      setError('');
                      setBusy(true);
                      try {
                        setDeleting({
                          id: dataset.id,
                          ...(await api.datasetDeletionPreview(
                            dataset.id,
                            token,
                          )),
                        });
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </article>
            ))}
          </div>

          {deleting && (
            <section
              className="dataset-delete-confirm"
              role="alertdialog"
              aria-label="Удалить Dataset"
            >
              <strong>Удалить «{deleting.name}»?</strong>
              <p>
                {deleting.rows} строк · {deleting.bindings} привязок ·{' '}
                {deleting.relations} связей · {deleting.views} представлений в
                индексе досок.
              </p>
              <p>
                Табличные представления и связи будут убраны со всех досок.
                Самостоятельные визуальные объекты сохранятся без привязки.
                Отменить удаление через Undo нельзя.
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api.deleteDataset(deleting.id, token);
                    setDeleting(null);
                    await load();
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Удалить Dataset и представления
              </button>
              <button disabled={busy} onClick={() => setDeleting(null)}>
                Отмена
              </button>
            </section>
          )}
          <p className="datasets-panel__hint">
            Drop a CSV directly on the canvas to create another reusable
            dataset. Placing the same dataset twice creates two synchronized
            views of one source.
          </p>
        </>
      )}
    </aside>
  );
}
