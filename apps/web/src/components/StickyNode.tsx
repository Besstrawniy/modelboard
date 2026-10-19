import { CanvasHandles } from './CanvasHandles';
import { CanvasInlineText } from './CanvasInlineText';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { type NodeProps } from '@xyflow/react';
import { useBoardActions } from './BoardContext';

export function StickyNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly } = useBoardActions();
  return (
    <div className={`sticky-node ${selected ? 'is-selected' : ''}`}><CanvasHandles />
      {!readOnly && <CanvasNodeResizer minWidth={160} minHeight={120} isVisible={selected} />}
      <CanvasInlineText id={id} value={String(data.text ?? '')} placeholder="Заметка" />
    </div>
  );
}
