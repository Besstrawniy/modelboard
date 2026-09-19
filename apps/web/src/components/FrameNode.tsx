import {
  NodeResizer,
  type NodeProps,
} from '@xyflow/react';
import { useBoardActions } from './BoardContext';

export function FrameNode({
  id,
  data,
  selected,
}: NodeProps<any>) {
  const { readOnly, updateNodeData } = useBoardActions();

  return (
    <div
      className={`frame-node ${selected ? 'is-selected' : ''}`}
    >
      {!readOnly && (
        <NodeResizer
          minWidth={280}
          minHeight={180}
          isVisible={selected}
        />
      )}

      <div className="frame-node__header">
        <input
          className="nodrag"
          disabled={readOnly}
          value={String(data?.title ?? '')}
          placeholder="Название секции"
          onChange={(event) =>
            updateNodeData(id, {
              title: event.target.value,
            })
          }
        />
      </div>

      <textarea
        className="frame-node__description nodrag"
        disabled={readOnly}
        value={String(data?.description ?? '')}
        placeholder="Описание…"
        onChange={(event) =>
          updateNodeData(id, {
            description: event.target.value,
          })
        }
      />
    </div>
  );
}
