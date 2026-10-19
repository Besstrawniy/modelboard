import { Handle, Position } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

/** Loose mode needs source handles at every endpoint, including left and bottom.
 * A non-interactive target preserves the left anchor of legacy ID-less edges. */
export function CanvasHandles() {
  const { readOnly } = useBoardActions();
  return <>
    <Handle type="target" position={Position.Left} isConnectable={false} className="canvas-legacy-port" />
    {[Position.Right, Position.Left, Position.Top, Position.Bottom].map(position =>
      <Handle key={position} type="source" position={position}
        id={`visual-${position}`} isConnectable={!readOnly} className="canvas-port" />)}
  </>;
}
