import { Network, X } from 'lucide-react';
import type { DeviceKind } from '@modelboard/shared';
import { DeviceGlyph, DEVICE_LABELS } from './DeviceNode';

const kinds: DeviceKind[] = [
  'SERVER',
  'VM',
  'SWITCH',
  'ROUTER',
  'FIREWALL',
  'DATABASE',
  'CLOUD',
];

export function DevicePalette({
  readOnly,
  onAdd,
  onClose,
}: {
  readOnly: boolean;
  onAdd: (kind: DeviceKind) => void;
  onClose: () => void;
}) {
  return (
    <aside className="device-palette">
      <header>
        <div><Network size={18} /> Инфраструктура</div>
        <button className="icon-button" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="device-palette__grid">
        {kinds.map((kind) => (
          <button
            key={kind}
            disabled={readOnly}
            onClick={() => onAdd(kind)}
            title={DEVICE_LABELS[kind]}
          >
            <span>
              <DeviceGlyph kind={kind} size={38} />
            </span>
            <strong>{DEVICE_LABELS[kind]}</strong>
          </button>
        ))}
      </div>

      <p className="device-palette__hint">
        Эти объекты можно привязать к Dataset Row через Inspector.
        Пользовательские SVG-библиотеки будут добавлены следующим слоем.
      </p>
    </aside>
  );
}
