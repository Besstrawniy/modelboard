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
  <button disabled={!viewName.trim()} onClick={()=>{onSaveView(viewName.trim());setViewName('');}}>Сохранить вид</button>
  <button disabled={!currentView} onClick={()=>onDeleteView(currentView)}>Удалить вид</button>
  <button disabled={rowIndex<=0} onClick={()=>onReorder('rows',rowId!,rowIndex-1)} title="Переместить выбранную строку вверх">Строка ↑</button>
  <button disabled={rowIndex<0||rowIndex>=dataset.rows.length-1} onClick={()=>onReorder('rows',rowId!,rowIndex+1)}>Строка ↓</button>
  <button disabled={columnIndex<=0} onClick={()=>onReorder('columns',columnId!,columnIndex-1)}>Колонка ←</button>
  <button disabled={columnIndex<0||columnIndex>=dataset.columns.length-1} onClick={()=>onReorder('columns',columnId!,columnIndex+1)}>Колонка →</button>
  <button disabled={!rowId} onClick={onCut}>Вырезать</button><button disabled={!rowId} onClick={onPasteValues}>Вставить значения</button>
  <button disabled={!rowId} onClick={()=>onFill('down')}>Заполнить вниз</button><button disabled={!rowId} onClick={()=>onFill('right')}>Заполнить вправо</button>
  <button onClick={()=>setRulesOpen(v=>!v)} aria-expanded={rulesOpen}>Условное оформление</button>
  <label>Цвет текста<input type="color" aria-label="Цвет текста ячеек" defaultValue="#30353d" onChange={e=>onFormat({color:e.target.value})}/></label>
  <button onClick={()=>onFormat({wrap:true})}>Перенос текста</button><button onClick={()=>onFormat({wrap:false})}>Без переноса</button>
  </>}
  <button disabled={!columnId} onClick={()=>onHide(columnId!)}>Скрыть колонку</button><button onClick={onShowAll}>Показать все колонки</button>
  <button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'asc')}>Добавить сортировку ↑</button><button disabled={!columnId} onClick={()=>onMultiSort(columnId!,'desc')}>Добавить сортировку ↓</button>
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
