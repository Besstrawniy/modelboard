import { Save, Trash2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Scissors, ClipboardPaste, Paintbrush, WrapText, AlignLeft, Eye, EyeOff, ArrowUpWideNarrow, ArrowDownWideNarrow } from 'lucide-react';
import { useState } from 'react';
import type { DatasetSnapshot, DatasetView, DatasetConditionalRule } from '@modelboard/shared';
export function SpreadsheetTools({dataset,readOnly,rowId,columnId,onReorder,onSaveView,onDeleteView,onApplyView,currentView,onSaveRule,onDeleteRule,onHide,onShowAll,onFill,onCut,onPasteValues,onFormat,onMultiSort}: {
 dataset:DatasetSnapshot;readOnly:boolean;rowId?:string;columnId?:string;
 onReorder:(kind:'rows'|'columns',id:string,to:number)=>void;
 onSaveView:(name:string)=>void;onDeleteView:(id:string)=>void;onApplyView:(view:DatasetView|null)=>void;currentView:string;
 onSaveRule:(rule:DatasetConditionalRule)=>void;onDeleteRule:(id:string)=>void;
 onHide:(id:string)=>void;onShowAll:()=>void;onFill:(direction:'down'|'right')=>void;onCut:()=>void;onPasteValues:()=>void;
 onFormat:(patch:any)=>void;onMultiSort:(columnId:string,direction:'asc'|'desc')=>void;
}) {
 const [viewName,setViewName]=useState('');const [rulesOpen,setRulesOpen]=useState(false);
 const [operator,setOperator]=useState<DatasetConditionalRule['operator']>('gt'),[value,setValue]=useState(''),[value2,setValue2]=useState(''),[background,setBackground]=useState('#ffe0df');
 const rowIndex=dataset.rows.findIndex(row=>row.id===rowId),columnIndex=dataset.columns.findIndex(column=>column.id===columnId);
 return <div className="spreadsheet-tools">
  <label>Представление <select aria-label="Представление таблицы" value={currentView} onChange={e=>onApplyView(dataset.views?.find(view=>view.id===e.target.value)??null)}>
    <option value="">Все данные</option>{dataset.views?.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}
  </select></label>
  {!readOnly&&<><input aria-label="Название представления" placeholder="Название вида" value={viewName} onChange={e=>setViewName(e.target.value)} maxLength={80}/>
  <button disabled={!viewName.trim()} onClick={()=>{onSaveView(viewName.trim());setViewName('');}} title="Сохранить вид" aria-label="Сохранить вид"><Save size={15}/></button>
  <button disabled={!currentView} onClick={()=>onDeleteView(currentView)} title="Удалить вид" aria-label="Удалить вид"><Trash2 size={15}/></button>
  <button disabled={rowIndex<=0} onClick={()=>onReorder('rows',rowId!,rowIndex-1)} title="Переместить выбранную строку вверх" aria-label="Строка ↑"><ArrowUp size={15}/></button>
  <button disabled={rowIndex<0||rowIndex>=dataset.rows.length-1} onClick={()=>onReorder('rows',rowId!,rowIndex+1)} title="Строка ↓" aria-label="Строка ↓"><ArrowDown size={15}/></button>
  <button disabled={columnIndex<=0} onClick={()=>onReorder('columns',columnId!,columnIndex-1)} title="Колонка ←" aria-label="Колонка ←"><ArrowLeft size={15}/></button>
  <button disabled={columnIndex<0||columnIndex>=dataset.columns.length-1} onClick={()=>onReorder('columns',columnId!,columnIndex+1)} title="Колонка →" aria-label="Колонка →"><ArrowRight size={15}/></button>
  <button disabled={!rowId} onClick={onCut} title="Вырезать" aria-label="Вырезать"><Scissors size={15}/></button><button disabled={!rowId} onClick={onPasteValues} title="Вставить значения" aria-label="Вставить значения"><ClipboardPaste size={15}/></button>
  <button disabled={!rowId} onClick={()=>onFill('down')} title="Заполнить вниз" aria-label="Заполнить вниз"><ArrowDown size={15}/></button><button disabled={!rowId} onClick={()=>onFill('right')} title="Заполнить вправо" aria-label="Заполнить вправо"><ArrowRight size={15}/></button>
  <button onClick={()=>setRulesOpen(v=>!v)} aria-expanded={rulesOpen} title="Условное оформление" aria-label="Условное оформление"><Paintbrush size={15}/></button>
  <label>Цвет текста<input type="color" aria-label="Цвет текста ячеек" defaultValue="#30353d" onChange={e=>onFormat({color:e.target.value})}/></label>
  <button onClick={()=>onFormat({wrap:true})} title="Перенос текста" aria-label="Перенос текста"><WrapText size={15}/></button><button onClick={()=>onFormat({wrap:false})} title="Без переноса" aria-label="Без переноса"><AlignLeft size={15}/></button>
  </>}
  <button disabled={!columnId} onClick={()=>onHide(columnId!)} title="Скрыть колонку" aria-label="Скрыть колонку"><EyeOff size={15}/></button><button onClick={onShowAll} title="Показать все колонки" aria-label="Показать все колонки"><Eye size={15}/></button>
  <button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'asc')} title="Добавить сортировку ↑" aria-label="Добавить сортировку ↑"><ArrowUpWideNarrow size={15}/></button><button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'desc')} title="Добавить сортировку ↓" aria-label="Добавить сортировку ↓"><ArrowDownWideNarrow size={15}/></button>
  {rulesOpen&&!readOnly&&<section className="spreadsheet-rules" aria-label="Правила условного оформления">
    <strong>{dataset.columns.find(column=>column.id===columnId)?.name??'Выберите колонку'}</strong>
    <select aria-label="Условие оформления" value={operator} onChange={e=>setOperator(e.target.value as any)}>{[['gt','Больше'],['lt','Меньше'],['eq','Равно'],['contains','Содержит'],['empty','Пусто'],['between','Между'],['duplicate','Дубликаты']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
    <input aria-label="Значение условия" value={value} onChange={e=>setValue(e.target.value)}/>{operator==='between'&&<input aria-label="Верхняя граница условия" value={value2} onChange={e=>setValue2(e.target.value)}/>}
    <input aria-label="Цвет условия" type="color" value={background} onChange={e=>setBackground(e.target.value)}/>
    <button disabled={!columnId} onClick={()=>onSaveRule({id:crypto.randomUUID(),columnId:columnId!,operator,value,value2,background})}>Добавить правило</button>
    {dataset.rules?.map(rule=><div key={rule.id}>{dataset.columns.find(column=>column.id===rule.columnId)?.name} · {rule.operator} {rule.value}<button aria-label="Удалить правило" onClick={()=>onDeleteRule(rule.id)}>×</button></div>)}
  </section>}
 </div>;
}
