import { CanvasNodeResizer } from './CanvasNodeResizer';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type {
  DeviceKind,
  DeviceNodeData,
  ObjectBindingRecord,
} from '@modelboard/shared';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';

export const DEVICE_LABELS: Record<DeviceKind, string> = {
  SERVER: 'Сервер',
  VM: 'Виртуальная машина',
  SWITCH: 'Коммутатор',
  ROUTER: 'Маршрутизатор',
  FIREWALL: 'Firewall',
  DATABASE: 'База данных',
  CLOUD: 'Cloud',
};

export function DeviceGlyph({
  kind,
  size = 42,
}: {
  kind: DeviceKind;
  size?: number;
}) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'DATABASE') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <ellipse cx="32" cy="15" rx="20" ry="8" {...common} />
        <path d="M12 15v17c0 4.5 9 8 20 8s20-3.5 20-8V15" {...common} />
        <path d="M12 31v17c0 4.5 9 8 20 8s20-3.5 20-8V31" {...common} />
      </svg>
    );
  }

  if (kind === 'CLOUD') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M18 48h29c7 0 11-4.4 11-10 0-5.3-4.1-9.4-9.4-9.9C46.4 19.9 40.2 15 32.8 15c-8.1 0-14.7 5.8-16.1 13.4C10.7 29 6 33.1 6 38.5 6 44 10.6 48 18 48Z"
          {...common}
        />
      </svg>
    );
  }

  if (kind === 'FIREWALL') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="8" y="12" width="48" height="40" rx="4" {...common} />
        <path d="M8 25h48M8 39h48M20 12v13M44 12v13M14 25v14M32 25v14M50 25v14M22 39v13M42 39v13" {...common} />
      </svg>
    );
  }

  if (kind === 'ROUTER') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="21" {...common} />
        <path d="M32 17v30M17 32h30M24 24l8-7 8 7M40 40l7-8-7-8M24 40l-7-8 7-8M24 40l8 7 8-7" {...common} />
      </svg>
    );
  }

  if (kind === 'SWITCH') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="7" y="18" width="50" height="28" rx="5" {...common} />
        <path d="M14 27h5M24 27h5M34 27h5M44 27h5M14 37h5M24 37h5M34 37h5M44 37h5" {...common} />
      </svg>
    );
  }

  if (kind === 'VM') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <rect x="11" y="15" width="34" height="28" rx="4" {...common} />
        <rect x="20" y="24" width="34" height="28" rx="4" {...common} />
        <path d="M27 45h20" {...common} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="12" y="8" width="40" height="48" rx="5" {...common} />
      <path d="M12 23h40M12 39h40" {...common} />
      <circle cx="20" cy="16" r="2" {...common} />
      <circle cx="20" cy="31" r="2" {...common} />
      <circle cx="20" cy="47" r="2" {...common} />
      <path d="M29 16h15M29 31h15M29 47h15" {...common} />
    </svg>
  );
}

export function DeviceNode({ id, data, selected }: NodeProps<any>) {
  const { readOnly, sessionToken, updateNodeData } = useBoardActions();
  const device = data as DeviceNodeData;
  const kind = device.deviceKind ?? 'SERVER';
  const binding = device.binding as ObjectBindingRecord | null | undefined;

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
    : device.label || DEVICE_LABELS[kind];

  const subtitle = boundRow && subtitleColumnId
    ? String(boundRow.values[subtitleColumnId] ?? '')
    : '';

  return (
    <div className={`device-node ${selected ? 'is-selected' : ''} ${binding ? 'is-bound' : ''}`}>
      {!readOnly && (
        <CanvasNodeResizer
          minWidth={170}
          minHeight={110}
          isVisible={selected}
        />
      )}

      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />

      <div className="device-node__glyph">
        <DeviceGlyph kind={kind} size={46} />
      </div>

      <div className="device-node__body">
        <span className="device-node__kind">
          {DEVICE_LABELS[kind]}
          {binding ? ' · DATA' : ''}
        </span>

        {binding ? (
          <>
            <strong>{title || 'Без значения'}</strong>
            {subtitle && <small>{subtitle}</small>}
          </>
        ) : (
          <input
            className="nodrag"
            disabled={readOnly}
            value={device.label ?? ''}
            placeholder={DEVICE_LABELS[kind]}
            onChange={(event) =>
              updateNodeData(id, { label: event.target.value })
            }
          />
        )}
      </div>

      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}
