import { type NodeProps } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

export function TextNode({ id, data }: NodeProps<any>) {
  const { readOnly, updateNodeData } = useBoardActions();
  return (
    <input
      className="text-node nodrag"
      disabled={readOnly}
      value={String(data.text ?? '')}
      onChange={(event) => updateNodeData(id, { text: event.target.value })}
    />
  );
}
