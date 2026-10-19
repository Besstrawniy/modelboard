import type { Node } from '@xyflow/react';
import { useState } from 'react';
import { Copy, ClipboardPaste, RotateCw, PaintBucket, Pencil, Blend, MoveVertical, Minus } from 'lucide-react';
import { TextFormatControls } from './TextFormatControls';
import { ColorControl } from './ColorControl';

export function CanvasProperties({ node, onChange }: { node: Node; onChange: (patch: Record<string, unknown>) => void }) {
  const data = node.data;
  const [styleCopied, setStyleCopied] = useState(false);
  const styleKeys = ['fill','stroke','color','fontSize','fontFamily','bold','italic','underline','strokeWidth','strokeDash','opacity'];
  const defaults: Record<string, any> = { fill:node.type==='sticky'?'#fff1a8':'#ffffff',stroke:'#7d8794',color:'#344054',fontSize:node.type==='text'?22:16,opacity:100,fontFamily:node.type==='sticky'?'Segoe Print, Comic Sans MS, cursive':'Inter, sans-serif',strokeWidth:2,strokeDash:'solid',bold:false,italic:false,underline:false };
  const decorative = ['shape','sticky','frame','group','text'].includes(node.type ?? '');
  const preview = (key: string, color: string) => {
    document.querySelectorAll<HTMLElement>('.react-flow__node').forEach(element=>{if(element.dataset.id===node.id)element.style.setProperty(`--canvas-${key}`,color);});
  };
  return <div className="canvas-properties compact-properties" aria-label="Оформление объекта">
    {node.type==='shape'&&<div className="property-row"><select aria-label="Тип фигуры" title="Тип фигуры" value={String(data.shapeKind??'rectangle')} onChange={e=>onChange({shapeKind:e.target.value})}>{[['rectangle','Прямоугольник'],['triangle','Треугольник'],['circle','Круг'],['ellipse','Эллипс'],['diamond','Ромб']].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></div>}
    {decorative&&<>
      <TextFormatControls value={{...defaults,...data}} onChange={onChange} onPreviewColor={color=>preview('color',color)}/>
      <div className="property-row" role="group" aria-label="Контур и заливка">
        <label title="Толщина линии"><Minus size={15}/><input aria-label="Толщина линии" type="number" min={1} max={12} value={Number(data.strokeWidth??2)} onChange={e=>onChange({strokeWidth:Math.max(1,Math.min(12,Number(e.target.value)||1))})}/></label>
        <select aria-label="Стиль линии" title="Стиль линии" value={String(data.strokeDash??'solid')} onChange={e=>onChange({strokeDash:e.target.value})}><option value="solid">━━</option><option value="dashed">┄┄</option></select>
        <ColorControl label="Цвет линии" value={String(data.stroke??defaults.stroke)} onChange={stroke=>onChange({stroke})} onPreview={color=>preview('stroke',color)}><Pencil size={15}/></ColorControl>
        <ColorControl label="Заливка" value={String(data.fill??defaults.fill)} onChange={fill=>onChange({fill})} onPreview={color=>preview('fill',color)}><PaintBucket size={15}/></ColorControl>
      </div>
    </>}
    <div className="property-row" role="group" aria-label="Геометрия и стиль">
      <label title="Поворот"><RotateCw size={15}/><input aria-label="Поворот" type="number" min={-360} max={360} step={15} value={Number(data.rotation??0)} onChange={e=>onChange({rotation:Number(e.target.value)||0})}/></label>
      {['text','sticky'].includes(node.type??'')&&<button title="Подогнать высоту под текст" aria-label="Подогнать высоту под текст" onClick={()=>onChange({autoSize:true})}><MoveVertical size={15}/></button>}
      <label title="Непрозрачность, %"><Blend size={15}/><input aria-label="Непрозрачность" type="number" min={10} max={100} step={10} value={Number(data.opacity??100)} onChange={e=>onChange({opacity:Math.max(10,Math.min(100,Number(e.target.value)||100))})}/></label>
      {decorative&&<><button title={styleCopied?'Стиль сохранён':'Копировать стиль'} aria-label="Копировать стиль" onClick={()=>{localStorage.setItem('modelboard:object-style',JSON.stringify(Object.fromEntries(styleKeys.map(key=>[key,data[key]??defaults[key]]))));setStyleCopied(true);}}><Copy size={16}/></button><button title="Применить стиль" aria-label="Применить стиль" onClick={()=>{try{const style=JSON.parse(localStorage.getItem('modelboard:object-style')||'{}');onChange(Object.fromEntries(styleKeys.filter(key=>style[key]!==undefined).map(key=>[key,style[key]])));}catch{/* invalid local style */}}}><ClipboardPaste size={16}/></button></>}
    </div>
  </div>;
}
