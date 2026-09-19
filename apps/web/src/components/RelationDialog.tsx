import { ArrowRight, Link2, X } from 'lucide-react';
import type {
  DatasetMeta,
  DatasetRelationCardinality,
  DatasetRelationType,
} from '@modelboard/shared';
import type { Connection } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export type PendingRelation = {
  connection: Connection;
  sourceDatasetId: string;
  sourceColumnId: string;
  targetDatasetId: string;
  targetColumnId: string;
};

export function RelationDialog({
  relation,
  token,
  onCancel,
  onConfirm,
}: {
  relation: PendingRelation;
  token: string;
  onCancel: () => void;
  onConfirm: (
    relationType: DatasetRelationType,
    cardinality: DatasetRelationCardinality | null,
  ) => Promise<void>;
}) {
  const [source, setSource] = useState<DatasetMeta | null>(null);
  const [target, setTarget] = useState<DatasetMeta | null>(null);
  const [relationType, setRelationType] =
    useState<DatasetRelationType>('FOREIGN_KEY');
  const [cardinality, setCardinality] =
    useState<DatasetRelationCardinality | ''>('N:1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      api.dataset(relation.sourceDatasetId, token),
      api.dataset(relation.targetDatasetId, token),
    ]).then(([sourceMeta, targetMeta]) => {
      setSource(sourceMeta);
      setTarget(targetMeta);
    }).catch((err) => setError(String(err)));
  }, [relation.sourceDatasetId, relation.targetDatasetId, token]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(
        relationType,
        cardinality === '' ? null : cardinality,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section className="relation-dialog" role="dialog" aria-modal="true">
        <header className="relation-dialog__header">
          <div><Link2 size={18} /> Создать связь данных</div>
          <button className="icon-button" disabled={busy} onClick={onCancel}>
            <X size={18} />
          </button>
        </header>

        <div className="relation-dialog__body">
          <div className="relation-endpoints">
            <div className="relation-endpoint">
              <strong>{source?.name ?? 'Исходный Dataset'}</strong>
              <small>column: {relation.sourceColumnId}</small>
            </div>
            <ArrowRight className="relation-arrow" size={18} />
            <div className="relation-endpoint">
              <strong>{target?.name ?? 'Целевой Dataset'}</strong>
              <small>column: {relation.targetColumnId}</small>
            </div>
          </div>

          <div className="relation-form">
            <label>
              Тип связи
              <select
                value={relationType}
                onChange={(event) =>
                  setRelationType(event.target.value as DatasetRelationType)
                }
              >
                <option value="FOREIGN_KEY">Foreign key (FK)</option>
                <option value="REFERENCE">Reference</option>
                <option value="DEPENDENCY">Dependency</option>
                <option value="MAP">Mapping</option>
                <option value="FLOW">Data flow</option>
              </select>
            </label>

            <label>
              Кардинальность
              <select
                value={cardinality}
                onChange={(event) =>
                  setCardinality(
                    event.target.value as DatasetRelationCardinality | '',
                  )
                }
              >
                <option value="">Не указана</option>
                <option value="1:1">1:1</option>
                <option value="1:N">1:N</option>
                <option value="N:1">N:1</option>
                <option value="N:M">N:M</option>
              </select>
            </label>
          </div>

          <p className="relation-dialog__hint">
            Это семантическая связь между Dataset, а не просто стрелка.
            Линия на этой доске будет ссылаться на сохранённый relationId.
          </p>

          {error && <div className="relation-dialog__error">{error}</div>}
        </div>

        <footer className="relation-dialog__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button className="primary-button" disabled={busy} onClick={submit}>
            <Link2 size={15} />
            {busy ? 'Сохранение…' : 'Создать связь'}
          </button>
        </footer>
      </section>
    </div>
  );
}
