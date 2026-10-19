import { CanvasHandles } from './CanvasHandles';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { CanvasInlineText } from './CanvasInlineText';
import { type NodeProps } from '@xyflow/react';
export function FrameNode({ id, data, selected, type }: NodeProps<any>) {
  return <div className={`frame-node ${type === 'group' ? 'group-node' : ''} ${selected ? 'is-selected' : ''}`}><CanvasHandles />
    <CanvasNodeResizer minWidth={100} minHeight={80} isVisible={selected} />
    <div className="frame-node__header"><CanvasInlineText id={id} field="title" value={String(data.title ?? '')} placeholder={type === 'group' ? 'Группа' : 'Секция'} multiline={false} /></div>
    {type !== 'group' && <CanvasInlineText id={id} field="description" value={String(data.description ?? '')} placeholder="Описание…" className="frame-node__description" />}
  </div>;
}
