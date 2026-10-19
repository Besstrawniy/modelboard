import { CanvasHandles } from './CanvasHandles';
import { useStore } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { relatedRows } from '@modelboard/shared';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { ExternalLink, Link2 } from 'lucide-react';
import type { DatasetRow, RelationViewNodeData } from '@modelboard/shared';
import { type NodeProps } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';

function rowFields(
  row: DatasetRow,
  columns: Array<{ id: string; name: string }>,
) {
  return columns
    .slice(0, 4)
    .map((column) => ({
      id: column.id,
      name: column.name,
      value: row.values[column.id],
    }))
    .filter(
      (field) =>
        field.value !== null &&
        field.value !== undefined &&
        String(field.value) !== '',
    )
    .slice(0, 3);
}

export function RelationViewNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly, sessionToken, workspaceId, openDatasetSheet } =
    useBoardActions();

  const limit = useStore(
    (state) => Number(state.nodeLookup.get(id)?.style?.height) || 290,
  );
  const node = data as RelationViewNodeData;
  const binding = node.binding;
  const [relation, setRelation] = useState<any>(null);

  const { dataset: anchorDataset } = useCollaborativeDataset(
    binding.datasetId,
    sessionToken,
    true,
  );

  useEffect(() => {
    const load = () =>
      api
        .relations(workspaceId, sessionToken)
        .then((relations) =>
          setRelation(
            relations.find((item) => item.id === node.relationId) ?? null,
          ),
        )
        .catch(() => setRelation(null));
    void load();
    const refresh = () => void load();
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [node.relationId, sessionToken, workspaceId]);

  const otherDatasetId = relation
    ? relation.sourceDatasetId === binding.datasetId
      ? relation.targetDatasetId
      : relation.sourceDatasetId
    : undefined;

  const { dataset: otherDataset } = useCollaborativeDataset(
    otherDatasetId,
    sessionToken,
    true,
  );

  const anchorRow = binding.rowId
    ? anchorDataset?.rows.find((row) => row.id === binding.rowId)
    : undefined;

  const currentIsSource = relation?.sourceDatasetId === binding.datasetId;
  const localColumnId = relation
    ? currentIsSource
      ? relation.sourceColumnId
      : relation.targetColumnId
    : undefined;
  const remoteColumnId = relation
    ? currentIsSource
      ? relation.targetColumnId
      : relation.sourceColumnId
    : undefined;

  const localColumn = anchorDataset?.columns.find(
    (column) => column.id === localColumnId,
  );
  const remoteColumn = otherDataset?.columns.find(
    (column) => column.id === remoteColumnId,
  );
  const localValue =
    anchorRow && localColumnId ? anchorRow.values[localColumnId] : null;

  const matches = useMemo(
    () =>
      otherDataset && relation && anchorDataset && anchorRow
        ? relatedRows(relation, anchorDataset.id, anchorRow, otherDataset.rows)
        : [],
    [relation, anchorDataset, anchorRow, otherDataset],
  );

  const [scrollTop, setScrollTop] = useState(0);
  const windowSize = Math.max(12, Math.ceil(limit / 40) + 4);
  const first =
    matches.length > 100
      ? Math.max(
          0,
          Math.min(Math.floor(scrollTop / 40) - 2, matches.length - windowSize),
        )
      : 0;
  const last =
    matches.length > 100
      ? Math.min(matches.length, first + windowSize)
      : matches.length;

  return (
    <div
      style={{ '--data-view-max-height': `${limit}px` } as CSSProperties}
      className={`relation-view-node ${selected ? 'is-selected' : ''}`}
    ><CanvasHandles />
      {!readOnly && (
        <CanvasNodeResizer
          minWidth={300}
          minHeight={180}
          isVisible={selected}
        />
      )}



      <header className="relation-view-node__header">
        <div>
          <Link2 size={14} />
          <strong>{otherDataset?.name ?? 'Relation View'}</strong>
        </div>
        <span>
          {relation?.relationType ?? 'RELATION'}
          {relation?.cardinality ? ` · ${relation.cardinality}` : ''}
        </span>
      </header>

      <div className="relation-view-node__path">
        <span>
          {anchorDataset?.name ?? 'Dataset'}.
          {relation?.matchMode === 'ROW_LINKS'
            ? 'запись'
            : (localColumn?.name ?? '…')}
        </span>
        <code>
          {relation?.matchMode === 'ROW_LINKS'
            ? '→'
            : String(localValue ?? 'NULL')}
        </code>
        <span>
          {otherDataset?.name ?? 'Dataset'}.
          {relation?.matchMode === 'ROW_LINKS'
            ? 'записи'
            : (remoteColumn?.name ?? '…')}
        </span>
      </div>

      <div className="relation-view-node__summary">
        Найдено связанных строк: <strong>{matches.length}</strong>
      </div>

      <div
        className="relation-view-node__rows nodrag nowheel"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {first > 0 && <div aria-hidden="true" style={{ height: first * 40 }} />}
        {matches.length === 0 ? (
          <div className="relation-view-node__empty">
            Связанных записей пока нет.
          </div>
        ) : (
          matches.slice(first, last).map((row) => {
            const fields = otherDataset
              ? rowFields(row, otherDataset.columns)
              : [];

            return (
              <button
                className="relation-view-node__row nodrag"
                key={row.id}
                onClick={() =>
                  otherDataset && openDatasetSheet(otherDataset.id, row.id)
                }
              >
                <div>
                  {fields.map((field) => (
                    <span key={field.id}>
                      <small>{field.name}</small>
                      <strong>{String(field.value)}</strong>
                    </span>
                  ))}
                </div>
                <ExternalLink size={12} />
              </button>
            );
          })
        )}

        {last < matches.length && (
          <div
            aria-hidden="true"
            style={{ height: (matches.length - last) * 40 }}
          />
        )}
      </div>


    </div>
  );
}
