import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

export function ShapeNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly, updateNodeData } = useBoardActions();
  return (
    <div className={`shape-node ${selected ? 'is-selected' : ''}`}>
      {!readOnly && <NodeResizer minWidth={120} minHeight={70} isVisible={selected} />}
      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />
      <input
        className="nodrag"
        disabled={readOnly}
        value={String(data.text ?? '')}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
      />
      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}
