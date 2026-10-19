import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { useBoardActions } from './BoardContext';
import { api } from '../lib/api';
export function ImageNode({ data, selected }: NodeProps<any>) {
  const { sessionToken, readOnly } = useBoardActions();
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setUrl('');
    setError('');
    void api
      .fileBlob(String(data.assetId), sessionToken)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data.assetId, sessionToken]);
  return (
    <div className="image-node">
      <CanvasNodeResizer
        minWidth={60}
        minHeight={40}
        isVisible={selected}
        keepAspectRatio
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={!readOnly}
      />
      {url ? (
        <img
          src={url}
          alt={String(data.name ?? 'Изображение')}
          draggable={false}
        />
      ) : (
        <span>{error || 'Загрузка изображения…'}</span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={!readOnly}
      />
    </div>
  );
}
