import type { NodeProps } from '@xyflow/react';
import type { FreehandStroke } from '@modelboard/shared';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { freehandPath } from '../lib/freehandGeometry';

export function FreehandNode({ data, selected }: NodeProps<any>) {
  const stroke = data.stroke as FreehandStroke;
  return <div className="freehand-node">
    <CanvasNodeResizer minWidth={8} minHeight={8} isVisible={selected} />
    <svg viewBox={`0 0 ${data.baseWidth} ${data.baseHeight}`} preserveAspectRatio="none" width="100%" height="100%">
      <path d={freehandPath(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}
