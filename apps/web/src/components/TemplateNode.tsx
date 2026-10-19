import { CanvasHandles } from './CanvasHandles';
import { BoundData } from './BoundData';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import {
    type NodeProps,
} from '@xyflow/react';
import type {
  ObjectBindingRecord,
  TemplateNodeData,
} from '@modelboard/shared';
import { useMemo } from 'react';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function TemplateNode({ data, selected }: NodeProps<any>) {
  const {
    readOnly,
    sessionToken,
    workspaceTemplates,
  } = useBoardActions();

  const node = data as TemplateNodeData;
  const template = workspaceTemplates.find(
    (item) => item.id === node.templateId,
  );
  const binding =
    node.binding as ObjectBindingRecord | null | undefined;

  const title=node.label||template?.name||'SVG template';

  const source = useMemo(
    () => template ? svgDataUrl(template.svg) : '',
    [template?.svg],
  );

  return (
    <div className={`template-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''}`}><CanvasHandles />
      {!readOnly && (
        <CanvasNodeResizer
          minWidth={90}
          minHeight={80}
          isVisible={selected}
        />
      )}



      <div className="template-node__visual">
        {source ? (
          <img
            src={source}
            alt=""
            draggable={false}
          />
        ) : (
          <div className="template-node__missing">
            SVG-шаблон удалён
          </div>
        )}
      </div>

      <div className="template-node__caption">
        <span>{template?.name ?? 'Workspace SVG'}</span>
        {binding?<BoundData binding={binding}/>:<strong>{title}</strong>}
      </div>


    </div>
  );
}
