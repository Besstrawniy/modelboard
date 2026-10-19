import { useEffect, useId, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, Layers, Copy,
  Frame as FrameIcon, Trash2, ChevronDown, Group, Ungroup, Link, Unlink,
} from 'lucide-react';
import type { CanvasAlignment, CanvasDistribution, CanvasLayerAction } from '../lib/canvasGeometry';

const alignments = [
  ['left', 'По левому краю', AlignHorizontalJustifyStart],
  ['center', 'По центру по горизонтали', AlignHorizontalJustifyCenter],
  ['right', 'По правому краю', AlignHorizontalJustifyEnd],
  ['top', 'По верхнему краю', AlignVerticalJustifyStart],
  ['middle', 'По центру по вертикали', AlignVerticalJustifyCenter],
  ['bottom', 'По нижнему краю', AlignVerticalJustifyEnd],
] as const;

const layerActions = [
  ['front', 'На передний план', 'Ctrl+Shift+]'],
  ['forward', 'На слой вперёд', 'Ctrl+]'],
  ['backward', 'На слой назад', 'Ctrl+['],
  ['back', 'На задний план', 'Ctrl+Shift+['],
] as const;

export function CanvasSelectionActions({ count, busy, onAlign, onDistribute, onLayer, onDuplicate, onFrame, onGroup, onUngroup, onAttach, onDetach, onDelete }: {
  count: number;
  busy: boolean;
  onAlign: (mode: CanvasAlignment) => void;
  onDistribute: (mode: CanvasDistribution) => void;
  onLayer: (mode: CanvasLayerAction) => void;
  onDuplicate: () => void;
  onFrame: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onAttach: () => void;
  onDetach: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<'align' | 'layers' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as globalThis.Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    action();
    setOpen(null);
    trigger.current?.focus();
  };
  const toggle = (menu: 'align' | 'layers', button: HTMLButtonElement) => {
    trigger.current = button;
    setOpen((current) => current === menu ? null : menu);
  };

  return (
    <div className="selection-actions" ref={root} aria-label="Действия с выделением">
      <span>Выбрано: {count}</span>
      <div className="selection-actions__dropdown">
        <button disabled={busy || count < 2} aria-expanded={open === 'align'} aria-controls={`${id}-align`}
          onClick={(event) => toggle('align', event.currentTarget)} title="Выравнивание и равные промежутки" aria-label="Выровнять">
          <AlignHorizontalJustifyCenter size={14} /> <ChevronDown size={12} />
        </button>
        {open === 'align' && (
          <div className="selection-actions__menu" id={`${id}-align`} role="group" aria-label="Выравнивание объектов">
            {alignments.map(([mode, label, Icon]) => (
              <button key={mode} disabled={busy || count < 2} onClick={() => run(() => onAlign(mode))}>
                <Icon size={16} /> {label}
              </button>
            ))}
            <div className="selection-actions__separator" />
            <button disabled={busy || count < 3} onClick={() => run(() => onDistribute('horizontal'))}>
              <AlignHorizontalSpaceBetween size={16} /> Равные промежутки по горизонтали
            </button>
            <button disabled={busy || count < 3} onClick={() => run(() => onDistribute('vertical'))}>
              <AlignVerticalSpaceBetween size={16} /> Равные промежутки по вертикали
            </button>
          </div>
        )}
      </div>
      <div className="selection-actions__dropdown">
        <button disabled={busy} aria-expanded={open === 'layers'} aria-controls={`${id}-layers`}
          onClick={(event) => toggle('layers', event.currentTarget)} title="Порядок слоёв" aria-label="Слои">
          <Layers size={14} /> <ChevronDown size={12} />
        </button>
        {open === 'layers' && (
          <div className="selection-actions__menu" id={`${id}-layers`} role="group" aria-label="Порядок слоёв">
            {layerActions.map(([mode, label, shortcut]) => (
              <button key={mode} disabled={busy} onClick={() => run(() => onLayer(mode))}>
                <span>{label}</span><kbd>{shortcut}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      <button disabled={busy} onClick={onDuplicate} title="Дублировать (Ctrl+D)" aria-label="Дублировать"><Copy size={14} /></button>
      <button disabled={busy || count < 2} onClick={onGroup} title="Группа (Ctrl+G)" aria-label="Группа"><Group size={16}/></button>
      <button disabled={busy} onClick={onUngroup} title="Разгруппировать (Ctrl+Shift+G)" aria-label="Разгруппировать"><Ungroup size={16}/></button>
      <button disabled={busy} onClick={onAttach} title="Прикрепить к окружающему Frame" aria-label="Прикрепить"><Link size={16}/></button>
      <button disabled={busy} onClick={onDetach} title="Отсоединить от контейнера" aria-label="Отсоединить"><Unlink size={16}/></button>
      <button disabled={busy} onClick={onFrame} title="Создать Frame вокруг выделения" aria-label="Во Frame"><FrameIcon size={14} /></button>
      <button disabled={busy} className="is-danger" onClick={onDelete} title="Удалить выделение" aria-label="Удалить"><Trash2 size={14} /></button>
    </div>
  );
}
