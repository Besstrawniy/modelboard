import { CanvasNodeResizer } from './CanvasNodeResizer';
import { Database } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ObjectBindingRecord, ShapeNodeData } from '@modelboard/shared';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

export function ShapeNode({ id, data, selected }: NodeProps<any>) {
  const {
    readOnly,
    sessionToken,
    updateNodeData,
  } = useBoardActions();

  const shape = data as ShapeNodeData;
  const binding = shape.binding as ObjectBindingRecord | undefined;
  const { dataset } = useCollaborativeDataset(
    binding?.datasetId,
    sessionToken,
    true,
  );

  const boundRow = binding?.rowId
    ? dataset?.rows.find((row) => row.id === binding.rowId)
    : undefined;

  const titleColumnId =
    (binding?.presentation?.titleColumnId as string | undefined) ??
    dataset?.columns[0]?.id;
  const subtitleColumnId =
    binding?.presentation?.subtitleColumnId as string | undefined;

  const title = boundRow && titleColumnId
    ? String(boundRow.values[titleColumnId] ?? '')
    : shape.text ?? 'Объект';

  const subtitle = boundRow && subtitleColumnId
    ? String(boundRow.values[subtitleColumnId] ?? '')
    : '';

  return (
    <div className={`shape-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''}`}>
      {!readOnly && (
        <CanvasNodeResizer
          minWidth={140}
          minHeight={84}
          isVisible={selected}
        />
      )}

      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />

      {binding ? (
        <div className="shape-node__bound">
          <div className="shape-node__binding-badge">
            <Database size={11} />
            DATA
          </div>
          <strong>{title || 'Без значения'}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
      ) : (
        <input
          className="nodrag"
          disabled={readOnly}
          value={String(shape.text ?? '')}
          placeholder="Объект"
          onChange={(event) =>
            updateNodeData(id, { text: event.target.value })
          }
        />
      )}

      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}
