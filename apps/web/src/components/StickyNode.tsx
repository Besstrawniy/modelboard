import { CanvasNodeResizer } from './CanvasNodeResizer';
import { type NodeProps } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

export function StickyNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly, updateNodeData } = useBoardActions();
  return (
    <div className={`sticky-node ${selected ? 'is-selected' : ''}`}>
      {!readOnly && <CanvasNodeResizer minWidth={160} minHeight={120} isVisible={selected} />}
      <textarea
        className="nodrag nowheel"
        disabled={readOnly}
        value={String(data.text ?? '')}
        placeholder="Write a note…"
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
      />
    </div>
  );
}
