import type { Node } from '@xyflow/react';
import { useState } from 'react';
import { Copy, ClipboardPaste, RotateCw, PaintBucket, Pencil, Type, Blend, MoveVertical, Square, Minus } from 'lucide-react';

export function CanvasProperties({ node, onChange }: { node: Node; onChange: (patch: Record<string, unknown>) => void }) {
  const data = node.data;
  const [styleCopied, setStyleCopied] = useState(false);
  const styleKeys = ['fill', 'stroke', 'color', 'fontSize', 'fontFamily', 'strokeWidth', 'strokeDash', 'opacity'];
  const defaults: Record<string, unknown> = { fill: node.type === 'sticky' ? '#fff1a8' : '#ffffff', stroke: '#7d8794', color: '#344054', fontSize: node.type === 'text' ? 22 : 16, opacity: 100, fontFamily: node.type === 'sticky' ? 'Segoe Print, Comic Sans MS, cursive' : 'Inter, sans-serif', strokeWidth: 2, strokeDash: 'solid' };
  const decorative = ['shape', 'sticky', 'frame', 'group', 'text'].includes(node.type ?? '');
  return <div className="canvas-properties compact-properties" aria-label="Оформление объекта">
    <label title="Поворот"><RotateCw size={15}/><input aria-label="Поворот" type="number" min={-360} max={360} step={15} value={Number(data.rotation ?? 0)} onChange={e => onChange({rotation: Number(e.target.value) || 0})}/></label>
    {decorative && <>
      {node.type === 'shape' && <label title="Тип фигуры"><Square size={15}/><select aria-label="Тип фигуры" value={String(data.shapeKind ?? 'rectangle')} onChange={e => onChange({shapeKind:e.target.value})}><option value="rectangle">▭ Прямоугольник</option><option value="triangle">△ Треугольник</option><option value="circle">○ Круг</option><option value="ellipse">⬭ Эллипс</option><option value="diamond">◇ Ромб</option></select></label>}
      {([['fill','Заливка',PaintBucket],['stroke','Цвет линии',Pencil],['color','Цвет текста',Type]] as const).map(([key,label,Icon]) => <label key={key} title={label}><Icon size={15}/><input aria-label={label} type="color" value={String(data[key] ?? defaults[key])} onChange={e => onChange({[key]:e.target.value})}/></label>)}
      <label title="Толщина линии"><Minus size={15}/><input aria-label="Толщина линии" type="number" min={1} max={12} value={Number(data.strokeWidth ?? 2)} onChange={e => onChange({strokeWidth:Math.max(1,Math.min(12,Number(e.target.value)||1))})}/></label>
      <select aria-label="Стиль линии" title="Стиль линии" value={String(data.strokeDash ?? 'solid')} onChange={e => onChange({strokeDash:e.target.value})}><option value="solid">━━</option><option value="dashed">┄┄</option></select>
      <select aria-label="Шрифт" title="Шрифт" value={String(data.fontFamily ?? defaults.fontFamily)} onChange={e => onChange({fontFamily:e.target.value})}><option value="Inter, sans-serif">Sans</option><option value="Georgia, serif">Serif</option><option value="monospace">Mono</option><option value="Segoe Print, Comic Sans MS, cursive">Рукописный</option></select>
      <label title="Размер текста"><Type size={15}/><input aria-label="Размер текста" type="number" min={10} max={96} value={Number(data.fontSize ?? defaults.fontSize)} onChange={e => onChange({fontSize:Math.max(10,Math.min(96,Number(e.target.value)||16))})}/></label>
      {['text','sticky'].includes(node.type ?? '') && <label title="Автовысота"><MoveVertical size={15}/><input aria-label="Автовысота" type="checkbox" checked={Boolean(data.autoSize ?? node.type === 'text')} onChange={e => onChange({autoSize:e.target.checked})}/></label>}
    </>}
    <label title="Непрозрачность, %"><Blend size={15}/><input aria-label="Непрозрачность" type="number" min={10} max={100} step={10} value={Number(data.opacity ?? 100)} onChange={e => onChange({opacity:Math.max(10,Math.min(100,Number(e.target.value)||100))})}/></label>
    {decorative && <>
      <button title={styleCopied ? 'Стиль сохранён' : 'Копировать стиль'} aria-label="Копировать стиль" onClick={() => {localStorage.setItem('modelboard:object-style',JSON.stringify(Object.fromEntries(styleKeys.map(key => [key,data[key] ?? defaults[key]]))));setStyleCopied(true);}}><Copy size={16}/></button>
      <button title="Применить стиль" aria-label="Применить стиль" onClick={() => {try {const style=JSON.parse(localStorage.getItem('modelboard:object-style')||'{}');onChange(Object.fromEntries(styleKeys.filter(key=>style[key]!==undefined).map(key=>[key,style[key]])));}catch{/* Ignore invalid local preferences. */}}}><ClipboardPaste size={16}/></button>
    </>}
  </div>;
}
