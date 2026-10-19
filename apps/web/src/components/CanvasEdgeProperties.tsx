import { ColorControl } from './ColorControl';
import { MarkerType, type Edge } from '@xyflow/react';
import { Type, Route, ArrowRight, Palette, Minus } from 'lucide-react';
export function CanvasEdgeProperties({edge,onChange}:{edge:Edge;onChange:(patch:Partial<Edge>)=>void}) {
  const color=String(edge.style?.stroke ?? '#64748b');
  return <div className="canvas-properties compact-properties" aria-label="Оформление коннектора">
    <label title="Подпись"><Type size={15}/><input aria-label="Подпись коннектора" defaultValue={typeof edge.label==='string'?edge.label:''} onBlur={event=>onChange({label:event.target.value})}/></label>
    <label title="Маршрут"><Route size={15}/><select aria-label="Маршрут коннектора" value={edge.type??'smoothstep'} onChange={event=>onChange({type:event.target.value})}><option value="smoothstep">С изгибом</option><option value="straight">Прямая</option><option value="default">Кривая</option></select></label>
    <label title="Стрелка"><ArrowRight size={15}/><input aria-label="Стрелка коннектора" type="checkbox" checked={Boolean(edge.markerEnd)} onChange={event=>onChange({markerEnd:event.target.checked?{type:MarkerType.ArrowClosed,color}:undefined})}/></label>
    <ColorControl label="Цвет коннектора" value={color} onChange={stroke=>onChange({style:{...edge.style,stroke},...(edge.markerEnd?{markerEnd:{type:MarkerType.ArrowClosed,color:stroke}}:{})})} onPreview={stroke=>document.querySelectorAll<SVGElement>('.react-flow__edge').forEach(element=>{if(element.dataset.id===edge.id)element.querySelector<SVGElement>('.react-flow__edge-path')?.style.setProperty('stroke',stroke);})}><Palette size={15}/></ColorControl>
    <label title="Толщина линии"><Minus size={15}/><input aria-label="Толщина коннектора" type="number" min={1} max={12} value={Number(edge.style?.strokeWidth??2)} onChange={event=>onChange({style:{...edge.style,strokeWidth:Math.max(1,Math.min(12,Number(event.target.value)||1))}})}/></label>
    <select aria-label="Стиль коннектора" title="Стиль коннектора" value={edge.style?.strokeDasharray?'dashed':'solid'} onChange={event=>onChange({style:{...edge.style,strokeDasharray:event.target.value==='dashed'?'8 5':undefined}})}><option value="solid">━━</option><option value="dashed">┄┄</option></select>
  </div>;
}
