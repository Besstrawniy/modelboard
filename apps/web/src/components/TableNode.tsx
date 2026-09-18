import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { TableNodeData } from '@modelboard/shared';
import { useBoardActions } from './BoardContext';

type TableCanvasNode = {
  id: string;
  data: TableNodeData;
  selected?: boolean;
};

export function TableNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly, updateNodeData } = useBoardActions();
  const table = data as TableNodeData;

  const setCell = (rowId: string, columnId: string, value: string) => {
    const rows = table.rows.map((row) =>
      row.id === rowId
        ? { ...row, values: { ...row.values, [columnId]: value } }
        : row,
    );
    updateNodeData(id, { rows });
  };

  return (
    <div className={`table-node ${selected ? 'is-selected' : ''}`}>
      {!readOnly && <NodeResizer minWidth={360} minHeight={180} isVisible={selected} />}
      <div className="table-node__title">
        <span className="table-node__kind">DATA</span>
        <strong>{table.title}</strong>
      </div>

      <div className="table-grid">
        <div className="table-grid__header table-grid__row">
          {table.columns.map((column) => (
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

        {table.rows.map((row) => (
          <div className="table-grid__row" key={row.id}>
            {table.columns.map((column) => (
              <div className="table-grid__cell" key={column.id}>
                <input
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
    </div>
  );
}
