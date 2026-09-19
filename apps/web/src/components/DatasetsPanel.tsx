import { Database, Plus, Table2, X } from 'lucide-react';
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
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setDatasets(await api.datasets(workspaceId, token));
  };

  useEffect(() => {
    void load();
  }, [workspaceId, token]);

  const create = async () => {
    if (readOnly) return;
    setBusy(true);
    try {
      const next = await api.createDataset(
        workspaceId,
        token,
        `dataset_${datasets.length + 1}`,
      );
      await load();
      onPlace(next.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="datasets-panel">
      <header>
        <div><Database size={18} /> Datasets</div>
        <button className="icon-button" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="datasets-panel__actions">
        <button disabled={readOnly || busy} onClick={create}>
          <Plus size={16} /> New dataset
        </button>
      </div>

      <div className="datasets-panel__list">
        {datasets.map((dataset) => (
          <article key={dataset.id} className="dataset-card">
            <div className="dataset-card__icon"><Table2 size={17} /></div>
            <div className="dataset-card__meta">
              <strong>{dataset.name}</strong>
              <small>{dataset.kind}</small>
            </div>
            <button
              disabled={readOnly}
              onClick={() => onPlace(dataset.id)}
              title="Place another view of this dataset on the board"
            >
              Place
            </button>
          </article>
        ))}
      </div>

      <p className="datasets-panel__hint">
        Placing the same dataset twice creates two views of one source. Edit either table and both update.
      </p>
    </aside>
  );
}
