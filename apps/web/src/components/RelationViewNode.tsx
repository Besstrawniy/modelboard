import { ExternalLink, Link2 } from 'lucide-react';
import type {
  DatasetRow,
  RelationViewNodeData,
} from '@modelboard/shared';
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';

function sameValue(left: unknown, right: unknown) {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return false;
  }
  return String(left) === String(right);
}

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

export function RelationViewNode({
  data,
  selected,
}: NodeProps<any>) {
  const {
    readOnly,
    sessionToken,
    workspaceId,
    openDatasetSheet,
  } = useBoardActions();

  const node = data as RelationViewNodeData;
  const binding = node.binding;
  const [relation, setRelation] = useState<any>(null);

  const { dataset: anchorDataset } = useCollaborativeDataset(
    binding.datasetId,
    sessionToken,
    true,
  );

  useEffect(() => {
    void api.relations(workspaceId, sessionToken)
      .then((relations) =>
        setRelation(
          relations.find((item) => item.id === node.relationId) ?? null,
        ),
      )
      .catch(() => setRelation(null));
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

  const currentIsSource =
    relation?.sourceDatasetId === binding.datasetId;
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
    anchorRow && localColumnId
      ? anchorRow.values[localColumnId]
      : null;

  const matches = useMemo(() => {
    if (
      !otherDataset ||
      !remoteColumnId ||
      localValue === null ||
      localValue === undefined
    ) {
      return [];
    }

    return otherDataset.rows.filter((row) =>
      sameValue(row.values[remoteColumnId], localValue),
    );
  }, [localValue, otherDataset, remoteColumnId]);

  const maxRows =
    typeof binding.presentation?.maxRows === 'number'
      ? Math.max(1, Math.min(20, binding.presentation.maxRows))
      : 8;

  return (
    <div className={`relation-view-node ${selected ? 'is-selected' : ''}`}>
      {!readOnly && (
        <NodeResizer
          minWidth={300}
          minHeight={180}
          isVisible={selected}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={!readOnly}
      />

      <header className="relation-view-node__header">
        <div>
          <Link2 size={14} />
          <strong>
            {otherDataset?.name ?? 'Relation View'}
          </strong>
        </div>
        <span>
          {relation?.relationType ?? 'RELATION'}
          {relation?.cardinality ? ` · ${relation.cardinality}` : ''}
        </span>
      </header>

      <div className="relation-view-node__path">
        <span>
          {anchorDataset?.name ?? 'Dataset'}.
          {localColumn?.name ?? '…'}
        </span>
        <code>{String(localValue ?? 'NULL')}</code>
        <span>
          {otherDataset?.name ?? 'Dataset'}.
          {remoteColumn?.name ?? '…'}
        </span>
      </div>

      <div className="relation-view-node__summary">
        Найдено связанных строк: <strong>{matches.length}</strong>
      </div>

      <div className="relation-view-node__rows">
        {matches.length === 0 ? (
          <div className="relation-view-node__empty">
            Связанных записей пока нет.
          </div>
        ) : (
          matches.slice(0, maxRows).map((row) => {
            const fields = otherDataset
              ? rowFields(row, otherDataset.columns)
              : [];

            return (
              <button
                className="relation-view-node__row nodrag"
                key={row.id}
                onClick={() =>
                  otherDataset &&
                  openDatasetSheet(otherDataset.id, row.id)
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

        {matches.length > maxRows && (
          <div className="relation-view-node__more">
            + ещё {matches.length - maxRows}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={!readOnly}
      />
    </div>
  );
}
