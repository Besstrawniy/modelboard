import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { TableNodeData } from '@modelboard/shared';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

export function TableNode({ data, selected }: NodeProps<any>) {
  const { readOnly, sessionToken } = useBoardActions();
  const view = data as TableNodeData;
  const { dataset, status, synced, setCell } = useCollaborativeDataset(
    view.datasetId,
    sessionToken,
    readOnly,
  );

  if (!view.datasetId) {
    return (
      <div className="table-node table-node--error">
        <div className="table-node__title"><strong>Legacy table</strong></div>
        <p>This v0.1 table has no datasetId. Recreate it from the Datasets panel.</p>
      </div>
    );
  }

  if (!dataset || !synced) {
    return (
      <div className="table-node table-node--loading">
        <div className="table-node__title">
          <span className="table-node__kind">DATASET</span>
          <strong>Загрузка данных…</strong>
          <span className="dataset-status">{status}</span>
        </div>
      </div>
    );
  }

  if (dataset.columns.length === 0) {
    return (
      <div className="table-node table-node--loading">
        <div className="table-node__title">
          <span className="table-node__kind">DATASET</span>
          <strong>Dataset пуст</strong>
          <span className="dataset-status">synced</span>
        </div>
      </div>
    );
  }

  const rows = dataset.rows.slice(0, view.view?.maxRows ?? 20);

  return (
    <div className={`table-node ${selected ? 'is-selected' : ''}`}>
      {!readOnly && <NodeResizer minWidth={360} minHeight={180} isVisible={selected} />}
      <div className="table-node__title">
        <span className="table-node__kind">DATASET</span>
        <strong>{view.view?.labelOverride || dataset.name}</strong>
        <span className="dataset-status">{status}</span>
      </div>

      <div className="table-grid">
        <div className="table-grid__header table-grid__row">
          {dataset.columns.map((column) => (
            <div className="table-grid__cell table-grid__column" key={column.id}>
              <Handle
                id={`target:${column.id}`}
                type="target"
                position={Position.Left}
                className="column-handle column-handle--left"
                isConnectable={!readOnly}
              />
              <div className="column-name">
                <span>{column.name}</span>
                {column.key && <em>{column.key}</em>}
              </div>
              <small>{column.dataType}</small>
              <Handle
                id={`source:${column.id}`}
                type="source"
                position={Position.Right}
                className="column-handle column-handle--right"
                isConnectable={!readOnly}
              />
            </div>
          ))}
        </div>

        {rows.map((row) => (
          <div className="table-grid__row" key={row.id}>
            {dataset.columns.map((column) => (
              <div className="table-grid__cell" key={column.id}>
                <input
                  style={(() => {
                    const format = dataset.formats.find(
                      (item) =>
                        item.rowId === row.id &&
                        item.columnId === column.id,
                    );

                    return {
                      fontWeight: format?.bold ? 700 : undefined,
                      fontStyle: format?.italic ? 'italic' : undefined,
                      textAlign:
                        format?.align === 'CENTER'
                          ? 'center'
                          : format?.align === 'RIGHT'
                            ? 'right'
                            : format?.align === 'LEFT'
                              ? 'left'
                              : undefined,
                      backgroundColor:
                        format?.background || undefined,
                    };
                  })()}
                  className="nodrag nowheel"
                  disabled={readOnly}
                  value={String(row.values[column.id] ?? '')}
                  onChange={(event) => setCell(row.id, column.id, event.target.value)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {dataset.rows.length > rows.length && (
        <div className="table-node__more">
          +{dataset.rows.length - rows.length} more rows
        </div>
      )}
    </div>
  );
}
