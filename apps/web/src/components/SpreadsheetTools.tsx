import { createId } from '../lib/uuid.ts';
import { Save, Trash2, Paintbrush, Eye, EyeOff, ArrowUpWideNarrow, ArrowDownWideNarrow } from 'lucide-react';
import { useState } from 'react';
import type { DatasetSnapshot, DatasetView, DatasetConditionalRule } from '@modelboard/shared';
export function SpreadsheetTools({dataset,readOnly,rowId,columnId,onSaveView,onDeleteView,onApplyView,currentView,onSaveRule,onDeleteRule,onHide,onShowAll,onMultiSort}: {
 dataset:DatasetSnapshot;readOnly:boolean;rowId?:string;columnId?:string;
 onSaveView:(name:string)=>void;onDeleteView:(id:string)=>void;onApplyView:(view:DatasetView|null)=>void;currentView:string;
 onSaveRule:(rule:DatasetConditionalRule)=>void;onDeleteRule:(id:string)=>void;
 onHide:(id:string)=>void;onShowAll:()=>void;
 onMultiSort:(columnId:string,direction:'asc'|'desc')=>void;
}) {
 const [viewName,setViewName]=useState('');const [rulesOpen,setRulesOpen]=useState(false);
 const [operator,setOperator]=useState<DatasetConditionalRule['operator']>('gt'),[value,setValue]=useState(''),[value2,setValue2]=useState(''),[background,setBackground]=useState('#ffe0df');
 return <div className="spreadsheet-tools">
  <label>Представление <select aria-label="Представление таблицы" value={currentView} onChange={e=>onApplyView(dataset.views?.find(view=>view.id===e.target.value)??null)}>
    <option value="">Все данные</option>{dataset.views?.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}
  </select></label>
  {!readOnly&&<><input aria-label="Название представления" placeholder="Название вида" value={viewName} onChange={e=>setViewName(e.target.value)} maxLength={80}/>
  <button disabled={!viewName.trim()} onClick={()=>{onSaveView(viewName.trim());setViewName('');}} title="Сохранить вид" aria-label="Сохранить вид"><Save size={15}/></button>
  <button disabled={!currentView} onClick={()=>onDeleteView(currentView)} title="Удалить вид" aria-label="Удалить вид"><Trash2 size={15}/></button>
  <button onClick={()=>setRulesOpen(v=>!v)} aria-expanded={rulesOpen} title="Условное оформление" aria-label="Условное оформление"><Paintbrush size={15}/></button>
  </>}
  <button disabled={!columnId} onClick={()=>onHide(columnId!)} title="Скрыть колонку" aria-label="Скрыть колонку"><EyeOff size={15}/></button><button onClick={onShowAll} title="Показать все колонки" aria-label="Показать все колонки"><Eye size={15}/></button>
  <button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'asc')} title="Добавить сортировку ↑" aria-label="Добавить сортировку ↑"><ArrowUpWideNarrow size={15}/></button><button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'desc')} title="Добавить сортировку ↓" aria-label="Добавить сортировку ↓"><ArrowDownWideNarrow size={15}/></button>
  {rulesOpen&&!readOnly&&<section className="spreadsheet-rules" aria-label="Правила условного оформления">
    <strong>{dataset.columns.find(column=>column.id===columnId)?.name??'Выберите колонку'}</strong>
    <select aria-label="Условие оформления" value={operator} onChange={e=>setOperator(e.target.value as any)}>{[['gt','Больше'],['lt','Меньше'],['eq','Равно'],['contains','Содержит'],['empty','Пусто'],['between','Между'],['duplicate','Дубликаты']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
    <input aria-label="Значение условия" value={value} onChange={e=>setValue(e.target.value)}/>{operator==='between'&&<input aria-label="Верхняя граница условия" value={value2} onChange={e=>setValue2(e.target.value)}/>}
    <input aria-label="Цвет условия" type="color" value={background} onChange={e=>setBackground(e.target.value)}/>
    <button disabled={!columnId} onClick={()=>onSaveRule({id:createId(),columnId:columnId!,operator,value,value2,background})}>Добавить правило</button>
    {dataset.rules?.map(rule=><div key={rule.id}>{dataset.columns.find(column=>column.id===rule.columnId)?.name} · {rule.operator} {rule.value}<button aria-label="Удалить правило" onClick={()=>onDeleteRule(rule.id)}>×</button></div>)}
  </section>}
 </div>;
}
