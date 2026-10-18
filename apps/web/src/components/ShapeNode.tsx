import { BoundData } from './BoundData';
import { CanvasInlineText } from './CanvasInlineText';
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
  } = useBoardActions();

  const shape = data as ShapeNodeData;
  const binding = shape.binding as ObjectBindingRecord | undefined;

  return (
    <div className={`shape-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''} shape-node--${String(data.shapeKind ?? 'rectangle')}`}>
      {data.shapeKind === 'diamond' && <svg className="shape-node__outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="50,1 99,50 50,99 1,50" fill="var(--canvas-fill, white)" stroke="var(--canvas-stroke, #7d8794)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>}
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
          <BoundData binding={binding}/>
        </div>
      ) : (
        <CanvasInlineText id={id} value={String(shape.text ?? '')} placeholder="Объект" />
      )}

      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}
