import type { CanvasAlignment, CanvasLayerAction } from './canvasGeometry';

export type CanvasContextCommand = 'copy' | 'paste' | 'duplicate' | 'frame' | 'delete' |
  'undo' | 'redo' | 'fit-selection' | 'fit-board' | 'align-menu' | 'layers-menu' | 'back' |
  `align:${CanvasAlignment}` | 'distribute:horizontal' | 'distribute:vertical' | `layer:${CanvasLayerAction}`;
export type CanvasContextItem = { command: CanvasContextCommand; label: string; shortcut?: string; disabled?: boolean; danger?: boolean };
export type CanvasContextOptions = { readOnly: boolean; selectionCount: number; canPaste: boolean; canUndo: boolean; canRedo: boolean; busy: boolean };

export function canvasContextItems(options: CanvasContextOptions, page: 'main' | 'align' | 'layers' = 'main'): CanvasContextItem[][] {
  const { readOnly, selectionCount: count, canPaste, canUndo, canRedo, busy } = options;
  if (page !== 'main' && (readOnly || count === 0)) return [];
  if (page === 'align') return [
    [{ command: 'back', label: '‹ Назад' }],
    ([['left', 'По левому краю'], ['center', 'По центру по горизонтали'], ['right', 'По правому краю'],
      ['top', 'По верхнему краю'], ['middle', 'По центру по вертикали'], ['bottom', 'По нижнему краю']] as const)
      .map(([mode, label]) => ({ command: `align:${mode}`, label, disabled: busy || count < 2 })),
    [
      { command: 'distribute:horizontal', label: 'Равные промежутки по горизонтали', disabled: busy || count < 3 },
      { command: 'distribute:vertical', label: 'Равные промежутки по вертикали', disabled: busy || count < 3 },
    ],
  ];
  if (page === 'layers') return [
    [{ command: 'back', label: '‹ Назад' }],
    [
      { command: 'layer:front', label: 'На передний план', shortcut: 'Ctrl+Shift+]', disabled: busy },
      { command: 'layer:forward', label: 'На слой вперёд', shortcut: 'Ctrl+]', disabled: busy },
      { command: 'layer:backward', label: 'На слой назад', shortcut: 'Ctrl+[', disabled: busy },
      { command: 'layer:back', label: 'На задний план', shortcut: 'Ctrl+Shift+[', disabled: busy },
    ],
  ];
  const groups: CanvasContextItem[][] = [];
  const objects: CanvasContextItem[] = [];
  if (count > 0) objects.push({ command: 'copy', label: 'Копировать', shortcut: 'Ctrl+C', disabled: busy });
  if (!readOnly) {
    objects.push({ command: 'paste', label: 'Вставить сюда', disabled: !canPaste || busy });
    if (count > 0) objects.push({ command: 'duplicate', label: 'Дублировать', shortcut: 'Ctrl+D', disabled: busy });
  }
  if (objects.length) groups.push(objects);
  if (!readOnly && count > 0) groups.push([
    { command: 'align-menu', label: 'Выровнять ›', disabled: busy || count < 2 },
    { command: 'layers-menu', label: 'Слои ›', disabled: busy },
    { command: 'frame', label: 'Во Frame', disabled: busy },
  ]);
  const navigation: CanvasContextItem[] = [{ command: 'fit-board', label: 'Показать всю доску', shortcut: 'Ctrl+0' }];
  if (count > 0) navigation.unshift({ command: 'fit-selection', label: 'Показать выделение', shortcut: 'F' });
  groups.push(navigation);
  if (!readOnly) groups.push([
    { command: 'undo', label: 'Отменить', shortcut: 'Ctrl+Z', disabled: !canUndo || busy },
    { command: 'redo', label: 'Повторить', shortcut: 'Ctrl+Y', disabled: !canRedo || busy },
  ]);
  if (!readOnly && count > 0) groups.push([{ command: 'delete', label: 'Удалить', shortcut: 'Delete', danger: true, disabled: busy }]);
  return groups;
}

export function selectCanvasContextTarget<T extends { id: string; selected?: boolean }>(nodes: T[], targetId: string): T[] {
  const target = nodes.find((node) => node.id === targetId);
  if (!target || target.selected) return nodes;
  return nodes.map((node) => ({ ...node, selected: node.id === targetId }));
}

export function canvasPasteOffset(nodes: Array<{ position: { x: number; y: number } }>, target: { x: number; y: number }) {
  if (!nodes.length) return { x: 0, y: 0 };
  return {
    x: target.x - Math.min(...nodes.map((node) => node.position.x)),
    y: target.y - Math.min(...nodes.map((node) => node.position.y)),
  };
}

export function clampCanvasMenuPosition(point: { x: number; y: number }, menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  return {
    x: Math.max(8, Math.min(point.x, viewport.width - menu.width - 8)),
    y: Math.max(8, Math.min(point.y, viewport.height - menu.height - 8)),
  };
}
