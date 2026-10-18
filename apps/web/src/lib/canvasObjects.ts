export type CanvasObjectNode = {
  id: string;
  type?: string;
  zIndex?: number;
  selected?: boolean;
  data?: Record<string, unknown>;
};

const typeLabels: Record<string, string> = {
  group: 'Группа', freehand: 'Штрих', frame: 'Frame', table: 'Таблица', shape: 'Фигура', sticky: 'Стикер', text: 'Текст',
  device: 'Устройство', template: 'Объект из шаблона', relationView: 'Представление связи',
};
const deviceLabels: Record<string, string> = {
  SERVER: 'Сервер', VM: 'Виртуальная машина', SWITCH: 'Коммутатор', ROUTER: 'Маршрутизатор',
  FIREWALL: 'Firewall', DATABASE: 'База данных', CLOUD: 'Cloud',
};
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function describeCanvasObject(node: CanvasObjectNode) {
  const data = node.data ?? {};
  const typeLabel = node.type === 'device' ? deviceLabels[String(data.deviceKind)] ?? 'Устройство' : typeLabels[node.type ?? ''] ?? 'Объект';
  const name = [data.title, data.label, data.text].map(clean).find(Boolean) ?? typeLabel;
  return { id: node.id, name, type: node.type ?? '', typeLabel, selected: Boolean(node.selected) };
}

/** Reverse paint order, including stable DOM order when zIndex values tie. */
export function listCanvasObjects(nodes: CanvasObjectNode[], search: string) {
  const words = clean(search).toLocaleLowerCase('ru').split(' ').filter(Boolean);
  return [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).reverse()
    .map(describeCanvasObject)
    .filter((item) => words.every((word) => `${item.name} ${item.typeLabel} ${item.type}`.toLocaleLowerCase('ru').includes(word)));
}

export function selectCanvasObjectIds({ currentIds, visibleIds, targetId, anchorId, toggle, range }: {
  currentIds: string[];
  visibleIds: string[];
  targetId: string;
  anchorId: string | null;
  toggle: boolean;
  range: boolean;
}) {
  const target = visibleIds.indexOf(targetId);
  if (target < 0) return currentIds;
  const anchor = anchorId ? visibleIds.indexOf(anchorId) : -1;
  if (range && anchor >= 0) {
    const chosen = visibleIds.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
    return toggle ? [...new Set([...currentIds, ...chosen])] : chosen;
  }
  if (toggle) return currentIds.includes(targetId) ? currentIds.filter((id) => id !== targetId) : [...currentIds, targetId];
  return [targetId];
}
