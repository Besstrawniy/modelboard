import { ArrowLeftRight, Database, Link2 } from 'lucide-react';
import type {
  DatasetRelation,
  DatasetRow,
  DatasetSnapshot,
} from '@modelboard/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

function sameValue(a: unknown, b: unknown) {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }
  return String(a) === String(b);
}

function compactRowLabel(row: DatasetRow, dataset: DatasetSnapshot) {
  const parts = dataset.columns
    .slice(0, 4)
    .map((column) => ({
      name: column.name,
      value: row.values[column.id],
    }))
    .filter(({ value }) => value !== null && value !== undefined && String(value) !== '');

  return parts.slice(0, 3);
}

function RelatedRelationSection({
  relation,
  currentDataset,
  currentRow,
  token,
}: {
  relation: DatasetRelation;
  currentDataset: DatasetSnapshot;
  currentRow: DatasetRow;
  token: string;
}) {
  const currentIsSource = relation.sourceDatasetId === currentDataset.id;
  const otherDatasetId = currentIsSource
    ? relation.targetDatasetId
    : relation.sourceDatasetId;

  const localColumnId = currentIsSource
    ? relation.sourceColumnId
    : relation.targetColumnId;

  const remoteColumnId = currentIsSource
    ? relation.targetColumnId
    : relation.sourceColumnId;

  const { dataset: otherDataset, status } = useCollaborativeDataset(
    otherDatasetId,
    token,
    true,
  );

  const localColumn = currentDataset.columns.find(
    (column) => column.id === localColumnId,
  );
  const localValue = currentRow.values[localColumnId];

  const matches = useMemo(() => {
    if (!otherDataset || localValue === null || localValue === undefined) {
      return [];
    }

    return otherDataset.rows.filter((row) =>
      sameValue(row.values[remoteColumnId], localValue),
    );
  }, [localValue, otherDataset, remoteColumnId]);

  const remoteColumn = otherDataset?.columns.find(
    (column) => column.id === remoteColumnId,
  );

  return (
    <article className="related-relation">
      <div className="related-relation__header">
        <div>
          <span className="related-relation__type">
            {relation.relationType}
          </span>
          {relation.cardinality && (
            <span className="related-relation__cardinality">
              {relation.cardinality}
            </span>
          )}
        </div>
        <small>{status}</small>
      </div>

      <div className="related-relation__path">
        <span>
          {currentDataset.name}.{localColumn?.name ?? localColumnId.slice(0, 8)}
        </span>
        <ArrowLeftRight size={12} />
        <span>
          {otherDataset?.name ?? 'Dataset'}.{remoteColumn?.name ?? remoteColumnId.slice(0, 8)}
        </span>
      </div>

      <div className="related-relation__value">
        Значение связи: <code>{String(localValue ?? 'NULL')}</code>
      </div>

      {matches.length === 0 ? (
        <p className="related-relation__empty">
          {otherDataset
            ? 'Связанные строки не найдены.'
            : 'Загрузка связанного Dataset…'}
        </p>
      ) : (
        <div className="related-records">
          {matches.slice(0, 20).map((row) => {
            const fields = otherDataset
              ? compactRowLabel(row, otherDataset)
              : [];

            return (
              <div className="related-record" key={row.id}>
                <div className="related-record__icon">
                  <Database size={13} />
                </div>
                <div className="related-record__content">
                  {fields.length ? (
                    fields.map(({ name, value }) => (
                      <div key={name}>
                        <small>{name}</small>
                        <strong>{String(value)}</strong>
                      </div>
                    ))
                  ) : (
                    <strong>{row.id}</strong>
                  )}
                </div>
              </div>
            );
          })}

          {matches.length > 20 && (
            <div className="related-records__more">
              + ещё {matches.length - 20}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function RelatedRecords({
  workspaceId,
  token,
  dataset,
  row,
}: {
  workspaceId: string;
  token: string;
  dataset: DatasetSnapshot;
  row: DatasetRow;
}) {
  const [relations, setRelations] = useState<DatasetRelation[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void api.relations(workspaceId, token)
      .then(setRelations)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [token, workspaceId]);

  const relevant = relations.filter(
    (relation) =>
      relation.sourceDatasetId === dataset.id ||
      relation.targetDatasetId === dataset.id,
  );

  if (error) {
    return <div className="inspector-error">{error}</div>;
  }

  return (
    <section className="inspector-section">
      <h3><Link2 size={14} /> Связанные данные</h3>

      {relevant.length === 0 ? (
        <p className="inspector-muted">
          Для этого Dataset пока нет семантических связей.
        </p>
      ) : (
        <div className="related-relations">
          {relevant.map((relation) => (
            <RelatedRelationSection
              key={relation.id}
              relation={relation}
              currentDataset={dataset}
              currentRow={row}
              token={token}
            />
          ))}
        </div>
      )}
    </section>
  );
}
