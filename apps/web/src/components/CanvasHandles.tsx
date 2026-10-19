import { Handle, Position } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

/** Loose connections let each visible port start or receive an edge. Keep the
 * legacy right source and left target first for edges without stored handles. */
export function CanvasHandles() {
  const { readOnly } = useBoardActions();
  return <>{[[Position.Right, 'source'], [Position.Left, 'target'], [Position.Top, 'source'], [Position.Bottom, 'target']].map(([position, type]) =>
    <Handle key={position} type={type as 'source' | 'target'} position={position as Position}
      id={`visual-${position}`} isConnectable={!readOnly} className="canvas-port" />)}</>;
}
