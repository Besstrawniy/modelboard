import type { Node } from '@xyflow/react';
import { useState } from 'react';

export function CanvasProperties({ node, onChange }: { node: Node; onChange: (patch: Record<string, unknown>) => void }) {
  const data = node.data;
  const [styleCopied, setStyleCopied] = useState(false);
  const styleKeys = ['fill', 'stroke', 'color', 'fontSize', 'opacity', 'shapeKind'];
  const defaults: Record<string, unknown> = { fill: node.type === 'sticky' ? '#fff1a8' : '#ffffff',
    stroke: '#7d8794', color: '#344054', fontSize: node.type === 'text' ? 22 : 16, opacity: 100, shapeKind: 'rectangle' };
  return <div className="canvas-properties" aria-label="Оформление объекта">
    <label>Поворот <input aria-label="Поворот" type="number" min={-360} max={360} step={15}
      value={Number(data.rotation ?? 0)} onChange={(e) => onChange({ rotation: Number(e.target.value) || 0 })} />°</label>
    {['shape', 'sticky', 'frame', 'group', 'text'].includes(node.type ?? '') && <>
      {node.type === 'shape' && <label>Фигура <select aria-label="Тип фигуры" value={String(data.shapeKind ?? 'rectangle')}
        onChange={(e) => onChange({ shapeKind: e.target.value })}>
        <option value="rectangle">Прямоугольник</option><option value="ellipse">Эллипс</option><option value="diamond">Ромб</option>
      </select></label>}
      <label>Заливка <input aria-label="Заливка" type="color" value={String(data.fill ?? (node.type === 'sticky' ? '#fff1a8' : '#ffffff'))}
        onChange={(e) => onChange({ fill: e.target.value })} /></label>
      <label>Линия <input aria-label="Цвет линии" type="color" value={String(data.stroke ?? '#7d8794')}
        onChange={(e) => onChange({ stroke: e.target.value })} /></label>
      <label>Текст <input aria-label="Цвет текста" type="color" value={String(data.color ?? '#344054')}
        onChange={(e) => onChange({ color: e.target.value })} /></label>
      {['text','sticky'].includes(node.type ?? '') && <label>Автовысота <input aria-label="Автовысота" type="checkbox" checked={Boolean(data.autoSize ?? node.type === 'text')} onChange={(e) => onChange({ autoSize:e.target.checked })} /></label>}
      <label>Размер <input aria-label="Размер текста" type="number" min={10} max={96} value={Number(data.fontSize ?? defaults.fontSize)}
        onChange={(e) => onChange({ fontSize: Math.max(10, Math.min(96, Number(e.target.value) || 16)) })} /></label>
    </>}
    <label>Непрозрачность <input aria-label="Непрозрачность" type="number" min={10} max={100} step={10}
      value={Number(data.opacity ?? 100)} onChange={(e) => onChange({ opacity: Math.max(10, Math.min(100, Number(e.target.value) || 100)) })} />%</label>
    {['shape','sticky','frame','group','text'].includes(node.type ?? '') && <>
    <button onClick={() => { localStorage.setItem('modelboard:object-style', JSON.stringify(Object.fromEntries(styleKeys.map((key) => [key,data[key] ?? defaults[key]])))); setStyleCopied(true); }}>
      {styleCopied ? 'Стиль сохранён' : 'Копировать стиль'}
    </button>
    <button onClick={() => { try { const style=JSON.parse(localStorage.getItem('modelboard:object-style') || '{}'); onChange(Object.fromEntries(styleKeys.filter((key) => style[key] !== undefined).map((key) => [key,style[key]]))); } catch { /* Invalid local preference: leave the object unchanged. */ } }}>Применить стиль</button></>}
  </div>;
}
