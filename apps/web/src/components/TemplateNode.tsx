import { CanvasNodeResizer } from './CanvasNodeResizer';
import {
  Handle,
  Position,
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

  const { dataset } = useCollaborativeDataset(
    binding?.datasetId,
    sessionToken,
    true,
  );

  const boundRow = binding?.rowId
    ? dataset?.rows.find((row) => row.id === binding.rowId)
    : undefined;

  const titleColumnId =
    (binding?.presentation?.titleColumnId as string | undefined) ??
    dataset?.columns[0]?.id;
  const subtitleColumnId =
    binding?.presentation?.subtitleColumnId as string | undefined;

  const title = boundRow && titleColumnId
    ? String(boundRow.values[titleColumnId] ?? '')
    : node.label || template?.name || 'SVG template';

  const subtitle = boundRow && subtitleColumnId
    ? String(boundRow.values[subtitleColumnId] ?? '')
    : '';

  const source = useMemo(
    () => template ? svgDataUrl(template.svg) : '',
    [template?.svg],
  );

  return (
    <div className={`template-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''}`}>
      {!readOnly && (
        <CanvasNodeResizer
          minWidth={90}
          minHeight={80}
          isVisible={selected}
        />
      )}

      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />

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
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>

      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}
