import { CanvasHandles } from './CanvasHandles';
import { type NodeProps } from '@xyflow/react';
import { CanvasInlineText } from './CanvasInlineText';
import { CanvasNodeResizer } from './CanvasNodeResizer';
export function TextNode({ id, data, selected }: NodeProps<any>) {
  return <div className="text-node"><CanvasHandles /><CanvasNodeResizer minWidth={100} minHeight={40} isVisible={selected} />
    <CanvasInlineText id={id} value={String(data.text ?? '')} placeholder="Текст" />
  </div>;
}
