import {
  ImagePlus,
  Network,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  DeviceKind,
  WorkspaceObjectTemplate,
} from '@modelboard/shared';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useBoardActions } from './BoardContext';
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

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function inferSvgDimensions(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;

  if (
    root.tagName.toLowerCase() !== 'svg' ||
    doc.querySelector('parsererror')
  ) {
    throw new Error('Не удалось разобрать SVG.');
  }

  const number = (value: string | null) => {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  let width = number(root.getAttribute('width'));
  let height = number(root.getAttribute('height'));

  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);

  if (
    (!width || !height) &&
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    const ratio = viewBox[2] / viewBox[3];
    width = ratio >= 1 ? 220 : 220 * ratio;
    height = ratio >= 1 ? 220 / ratio : 220;
  }

  return {
    width: Math.max(90, Math.min(520, Math.round(width ?? 220))),
    height: Math.max(80, Math.min(420, Math.round(height ?? 130))),
  };
}

function TemplatePreview({
  template,
}: {
  template: WorkspaceObjectTemplate;
}) {
  return (
    <img
      className="device-palette__svg-preview"
      src={svgDataUrl(template.svg)}
      alt=""
      draggable={false}
    />
  );
}

export function DevicePalette({
  readOnly,
  onAdd,
  onAddTemplate,
  onClose,
}: {
  readOnly: boolean;
  onAdd: (kind: DeviceKind) => void;
  onAddTemplate: (templateId: string) => void;
  onClose: () => void;
}) {
  const {
    workspaceId,
    sessionToken,
    workspaceTemplates,
    refreshWorkspaceTemplates,
  } = useBoardActions();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const importSvg = async (file: File) => {
    if (readOnly) return;

    setBusy(true);
    setError('');

    try {
      if (file.size > 250 * 1024) {
        throw new Error('SVG больше 250 КБ.');
      }

      const svg = await file.text();
      const { width, height } = inferSvgDimensions(svg);
      const name = file.name.replace(/\.svg$/i, '').trim() || 'SVG template';

      await api.createTemplate(
        workspaceId,
        sessionToken,
        {
          name,
          svg,
          defaultWidth: width,
          defaultHeight: height,
        },
      );

      await refreshWorkspaceTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeTemplate = async (
    event: React.MouseEvent,
    templateId: string,
  ) => {
    event.stopPropagation();
    if (readOnly) return;

    setBusy(true);
    setError('');
    try {
      await api.deleteTemplate(
        workspaceId,
        templateId,
        sessionToken,
      );
      await refreshWorkspaceTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="device-palette">
      <header>
        <div><Network size={18} /> Инфраструктура</div>
        <button className="icon-button" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="device-palette__section-title">
        Встроенные
      </div>

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

      <div className="device-palette__custom-header">
        <div>
          <ImagePlus size={14} />
          Workspace SVG
        </div>

        <button
          disabled={readOnly || busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={13} />
          Импорт SVG
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importSvg(file);
          }}
        />
      </div>

      {workspaceTemplates.length > 0 ? (
        <div className="device-palette__grid device-palette__grid--custom">
          {workspaceTemplates.map((template) => (
            <div
              key={template.id}
              role="button"
              tabIndex={readOnly || busy ? -1 : 0}
              aria-disabled={readOnly || busy}
              onClick={() => {
                if (!readOnly && !busy) {
                  onAddTemplate(template.id);
                }
              }}
              onKeyDown={(event) => {
                if (
                  !readOnly &&
                  !busy &&
                  (event.key === 'Enter' || event.key === ' ')
                ) {
                  event.preventDefault();
                  onAddTemplate(template.id);
                }
              }}
              title={template.name}
              className="device-palette__template"
            >
              <span>
                <TemplatePreview template={template} />
              </span>
              <strong>{template.name}</strong>
              {!readOnly && (
                <button
                  className="device-palette__delete-template"
                  onClick={(event) =>
                    void removeTemplate(event, template.id)
                  }
                  title="Удалить шаблон из Workspace"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="device-palette__empty">
          Пользовательских SVG пока нет.
        </p>
      )}

      {error && (
        <div className="device-palette__error">{error}</div>
      )}

      <p className="device-palette__hint">
        SVG хранится в Workspace. Новые шаблоны доступны всем участникам
        и могут иметь ROW binding так же, как Server/VM.
      </p>
    </aside>
  );
}
