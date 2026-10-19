import { Bold, Italic, Underline } from 'lucide-react';
import { ColorControl } from './ColorControl';
export const FONT_OPTIONS = [['Inter, sans-serif','Sans'],['Arial, sans-serif','Arial'],['Times New Roman, serif','Times New Roman'],['Georgia, serif','Georgia'],['monospace','Mono'],['Segoe Print, Comic Sans MS, cursive','Рукописный']];
export function TextFormatControls({ value, onChange, colorLabel = 'Цвет текста', onPreviewColor }: {
  value: { fontFamily?: string | null; fontSize?: number | null; color?: string | null; bold?: boolean; italic?: boolean; underline?: boolean };
  onChange: (patch: any) => void; colorLabel?: string; onPreviewColor?: (color: string) => void;
}) {
  return <div className="text-format-controls" role="group" aria-label="Шрифт и текст">
    <select aria-label="Шрифт" title="Шрифт" value={value.fontFamily ?? FONT_OPTIONS[0][0]} onChange={e=>onChange({fontFamily:e.target.value})}>{FONT_OPTIONS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
    <input aria-label="Размер текста" title="Размер текста" type="number" min={8} max={96} value={value.fontSize ?? 16} onChange={e=>onChange({fontSize:Math.max(8,Math.min(96,Number(e.target.value)||16))})}/>
    <ColorControl label={colorLabel} value={value.color ?? '#344054'} onChange={color=>onChange({color})} onPreview={onPreviewColor}/>
    {([['bold','Жирный',Bold],['italic','Курсив',Italic],['underline','Подчёркнутый',Underline]] as const).map(([key,label,Icon])=><button key={key} type="button" title={label} aria-label={label} aria-pressed={Boolean(value[key])} className={value[key]?'is-active':''} onClick={()=>onChange({[key]:!value[key]})}><Icon size={15}/></button>)}
  </div>;
}
