import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Layers3, LocateFixed, Search, X,
  Frame, Shapes, StickyNote, Type, Database, Network, Boxes, GitBranch } from 'lucide-react';
import { listCanvasObjects, selectCanvasObjectIds, type CanvasObjectNode } from '../lib/canvasObjects';
import type { CanvasLayerAction } from '../lib/canvasGeometry';

const glyphs = { frame: Frame, shape: Shapes, sticky: StickyNote, text: Type, table: Database,
  device: Network, template: Boxes, relationView: GitBranch };

function ObjectRow({ item, busy, onSelect, onFocus }: {
  item: ReturnType<typeof listCanvasObjects>[number];
  busy: boolean;
  onSelect: (id: string, toggle: boolean, range: boolean) => void;
  onFocus: (id: string) => void;
}) {
  const Icon = glyphs[item.type as keyof typeof glyphs] ?? Shapes;
  return (
    <li className={`canvas-objects__row ${item.selected ? 'is-selected' : ''}`}>
      <button className="canvas-objects__select" disabled={busy} aria-pressed={item.selected}
        title={`${item.name} · ${item.typeLabel}`}
        onClick={(event) => onSelect(item.id, event.ctrlKey || event.metaKey, event.shiftKey)}
        onDoubleClick={() => onFocus(item.id)}>
        <Icon size={16} />
        <span><strong>{item.name}</strong><small>{item.typeLabel}</small></span>
      </button>
      <button className="canvas-objects__locate" disabled={busy} onClick={() => onFocus(item.id)}
        title={`Показать на доске: ${item.name}`} aria-label={`Показать на доске: ${item.name}`}>
        <LocateFixed size={15} />
      </button>
    </li>
  );
}

export function CanvasObjectsPanel({ nodes, readOnly, busy, onSelect, onFocus, onLayer, onClose }: {
  nodes: CanvasObjectNode[];
  readOnly: boolean;
  busy: boolean;
  onSelect: (ids: string[]) => void;
  onFocus: (id: string) => void;
  onLayer: (action: CanvasLayerAction) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const anchor = useRef<string | null>(null);
  const items = useMemo(() => listCanvasObjects(nodes, search), [nodes, search]);
  const count = nodes.filter((node) => node.selected).length;
  const select = (id: string, toggle: boolean, range: boolean) => {
    const ids = selectCanvasObjectIds({ currentIds: nodes.filter((node) => node.selected).map((node) => node.id),
      visibleIds: items.map((item) => item.id), targetId: id, anchorId: anchor.current, toggle, range });
    if (!range || !items.some((item) => item.id === anchor.current)) anchor.current = id;
    onSelect(ids);
  };
  return (
    <aside className="canvas-objects" aria-label="Объекты и слои" onKeyDown={(event) => {
      if (event.key === ' ') event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
      <header><strong><Layers3 size={17} /> Объекты и слои</strong>
        <button onClick={onClose} aria-label="Закрыть объекты и слои"><X size={17} /></button>
      </header>
      <label className="canvas-objects__search"><Search size={15} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название или тип…" aria-label="Поиск объектов" />
        {search && <button onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={14} /></button>}
      </label>
      <p className="canvas-objects__count">{items.length} из {nodes.length} · выбрано {count}</p>
      <ul className="canvas-objects__list" aria-label="Список объектов, верхние слои первыми"
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.canvas-objects__select:not(:disabled)'));
          const row = (document.activeElement as HTMLElement | null)?.closest('li');
          const current = buttons.findIndex((button) => button.closest('li') === row);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
            Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
          buttons[index]?.focus();
        }}>
        {items.map((item) => <ObjectRow key={item.id} item={item} busy={busy} onSelect={select} onFocus={onFocus} />)}
        {items.length === 0 && <li className="canvas-objects__empty">
          {nodes.length ? 'Объекты не найдены. Попробуйте другой запрос.' : 'На доске пока нет объектов.'}
        </li>}
      </ul>
      {!readOnly && <div className="canvas-objects__layers" aria-label="Изменить слой выделенных объектов">
        {([
          ['front', 'На передний план', ChevronsUp], ['forward', 'На слой вперёд', ChevronUp],
          ['backward', 'На слой назад', ChevronDown], ['back', 'На задний план', ChevronsDown],
        ] as const).map(([action, title, Icon]) => (
          <button key={action} title={title} aria-label={title} disabled={busy || count === 0} onClick={() => onLayer(action)}><Icon size={17} /></button>
        ))}
      </div>}
      <p className="canvas-objects__hint">Ctrl / ⌘ + клик — добавить или убрать. Shift + клик — диапазон. Двойной клик — показать на доске.</p>
    </aside>
  );
}
