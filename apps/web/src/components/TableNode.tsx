import { useStore } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { DatasetConnections } from './DatasetConnections';
import { DatasetRename } from './DatasetRename';
import { CanvasNodeResizer } from './CanvasNodeResizer';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TableNodeData } from '@modelboard/shared';
import { useBoardActions } from './BoardContext';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { SheetCell } from './DatasetSheet';
import { compileFormula, formatFormula, formulaKey } from '../lib/formulas';
import { matchesSheetFilter, sheetConditionalFormat } from '../lib/spreadsheetModel';

export function TableNode({ id,data,selected }:NodeProps<any>) {
 const {readOnly,sessionToken,updateNodeData,openDatasetSheet}=useBoardActions();
 const limit=useStore(state=>Number(state.nodeLookup.get(id)?.style?.height)||300);
 const view=data as TableNodeData;
 const {dataset,status,synced,setCell,setFormula,pendingChanges,storageError}=useCollaborativeDataset(view.datasetId,sessionToken,readOnly);
 if(!view.datasetId||!dataset||!synced)return <div className="table-node table-node--loading"><strong>Загрузка Dataset…</strong><span>{status}</span></div>;
 const saved=dataset.views?.find(item=>item.id===view.view?.savedViewId);
 const columns=dataset.columns.filter(column=>!saved?.hiddenColumns.includes(column.id));
 let filtered=dataset.rows.filter(row=>(!saved?.query||dataset.columns.some(column=>String(row.values[column.id]??'').toLowerCase().includes(saved.query.toLowerCase())))&&Object.entries(saved?.filters??{}).every(([id,value])=>matchesSheetFilter(row.values[id],value)));
 if(saved?.sort.length)filtered=[...filtered].sort((a,b)=>{for(const sort of saved.sort){const av=a.values[sort.columnId],bv=b.values[sort.columnId];const difference=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true});if(difference)return sort.direction==='asc'?difference:-difference;}return 0;});
 const rows=filtered.slice(0,view.view?.maxRows??20);
 const formats=new Map(dataset.formats.map(format=>[formulaKey(format.rowId,format.columnId),format]));
 const formulas=new Map(dataset.formulas.map(formula=>[formulaKey(formula.rowId,formula.columnId),formula]));
 return <div style={{'--data-view-max-height':`${limit}px`} as CSSProperties} className={`table-node ${selected?'is-selected':''}`}>
  <Handle id="table:target" type="target" position={Position.Left} isConnectable={!readOnly} title="Связать записи таблиц" />
  <Handle id="table:source" type="source" position={Position.Right} isConnectable={!readOnly} title="Связать записи таблиц" />
  <CanvasNodeResizer minWidth={360} minHeight={180} isVisible={selected}/>
  <div className="table-node__title"><span className="table-node__kind">DATASET</span><strong>{view.view?.labelOverride||dataset.name}</strong><DatasetConnections dataset={dataset}/><DatasetRename id={dataset.id} name={dataset.name} token={sessionToken} readOnly={readOnly}/><span className="dataset-status">{pendingChanges?'saving':status}</span>
    <button className="nodrag" title="Открыть таблицу" onClick={()=>openDatasetSheet(dataset.id)}>Открыть</button>
  </div>
  {storageError&&<div className="sheet-storage-error" role="alert">{storageError}</div>}
  <div className="table-view-controls nodrag nowheel">
    <select aria-label="Представление на Canvas" value={saved?.id??''} disabled={readOnly} onChange={event=>updateNodeData(id,{view:{...view.view,savedViewId:event.target.value}})}><option value="">Все данные</option>{dataset.views?.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <span>{filtered.length} строк · {columns.length} колонок</span>
  </div>
  <div className="table-grid nowheel" style={{overflow:'auto'}}>
    <div className="table-grid__header table-grid__row" style={{gridTemplateColumns:`repeat(${columns.length},minmax(140px,1fr))`}}>
      {columns.map(column=><div className="table-grid__cell table-grid__column" key={column.id}>
        <Handle id={`target:${column.id}`} type="target" position={Position.Left} className="column-handle column-handle--left" isConnectable={!readOnly}/>
        <div className="column-name"><span>{column.name}</span>{column.key&&<em>{column.key}</em>}</div><small>{column.dataType}</small>
        <Handle id={`source:${column.id}`} type="source" position={Position.Right} className="column-handle column-handle--right" isConnectable={!readOnly}/>
      </div>)}
    </div>
    {rows.map(row=><div className="table-grid__row" key={row.id} style={{gridTemplateColumns:`repeat(${columns.length},minmax(140px,1fr))`}}>
      {columns.map(column=>{const key=formulaKey(row.id,column.id),formula=formulas.get(key);return <div className="table-grid__cell nodrag nowheel" key={column.id} data-row-id={row.id} data-column-id={column.id}>
        <SheetCell row={row} column={column} readOnly={readOnly} formulaActive={Boolean(formula)} formulaText={formula?formatFormula(formula.expression,dataset.columns,dataset.rows):undefined}
          format={{rowId:row.id,columnId:column.id,...formats.get(key),...sheetConditionalFormat(row,column.id,dataset.rules??[],dataset.rows)}}
          onChange={value=>{if(typeof value==='string'&&value.trim().startsWith('='))setFormula(row.id,column.id,compileFormula(value,dataset.columns,dataset.rows));else setCell(row.id,column.id,value);}}/>
      </div>;})}
    </div>)}
  </div>
  {filtered.length>rows.length&&<div className="table-node__more">Ещё {filtered.length-rows.length} строк — откройте таблицу для просмотра</div>}
 </div>;
}
