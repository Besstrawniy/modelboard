import { CanvasHandles } from './CanvasHandles';
import { BoundData } from './BoundData';
import { CanvasInlineText } from './CanvasInlineText';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { Database } from 'lucide-react';
import { type NodeProps } from '@xyflow/react';
import type { ObjectBindingRecord, ShapeNodeData } from '@modelboard/shared';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

export function ShapeNode({ id, data, selected }: NodeProps<any>) {
  const {
    readOnly,
    sessionToken,
  } = useBoardActions();

  const shape = data as ShapeNodeData;
  const binding = shape.binding as ObjectBindingRecord | undefined;

  return (
    <div className={`shape-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''} shape-node--${String(data.shapeKind ?? 'rectangle')}`}><CanvasHandles />
      {['diamond', 'triangle'].includes(data.shapeKind) && <svg className="shape-node__outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={data.shapeKind === 'triangle' ? "50,1 99,99 1,99" : "50,1 99,50 50,99 1,50"} fill="var(--canvas-fill, white)" stroke="var(--canvas-stroke, #7d8794)" strokeWidth={Number(data.strokeWidth ?? 2)} strokeDasharray={data.strokeDash === 'dashed' ? '8 5' : undefined} vectorEffect="non-scaling-stroke" />
      </svg>}
      {!readOnly && (
        <CanvasNodeResizer
          keepAspectRatio={data.shapeKind === 'circle'}
          minWidth={84}
          minHeight={84}
          isVisible={selected}
        />
      )}



      {binding ? (
        <div className="shape-node__bound">
          <div className="shape-node__binding-badge">
            <Database size={11} />
            DATA
          </div>
          <BoundData binding={binding}/>
        </div>
      ) : (
        <CanvasInlineText minimumRows={3} id={id} value={String(shape.text ?? '')} placeholder="Объект" />
      )}


    </div>
  );
}
