import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormula,formatFormula,translateFormulaForCopy,evaluateDatasetFormulas,formulaKey,retargetFormula} from '../apps/web/src/lib/formulas.ts';
import {parseSheetInput,parseSheetTsv,sheetTsv,matchesSheetFilter,sheetConditionalFormat,sheetSelectionSummary} from '../apps/web/src/lib/spreadsheetModel.ts';
import {CanvasNodeStore as Store} from '../packages/shared/src/canvasDocument.ts';
import * as Y from 'yjs';
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const columns=Array.from({length:5},(_,i)=>({id:id(i+1),name:['name','amount','cost','code','result'][i],ordinal:i,dataType:i===0?'TEXT':'NUMBER'}));
const rows=[['one',10,2,'x'],['two',20,4,'y'],['three',30,6,'z']].map((values,i)=>({id:id(i+10),ordinal:i,values:Object.fromEntries(values.map((v,j)=>[columns[j].id,v]))}));
const evalFormula=(expression)=>evaluateDatasetFormulas(rows,columns,[{rowId:rows[0].id,columnId:columns[4].id,expression:compileFormula(expression,columns,rows)}]).get(formulaKey(rows[0].id,columns[4].id));
test('absolute and mixed references preserve their locks during 2D copying',()=>{
 const first=compileFormula('=$B$1+B$1+$B1+B1',columns,rows);
 assert.equal(formatFormula(first,columns,rows),'=$B$1+B$1+$B1+B1');
 const next=translateFormulaForCopy(first,rows[0].id,columns[2].id,rows[1].id,columns[3].id,rows,columns);
 assert.equal(formatFormula(next,columns,rows),'=$B$1+C$1+$B2+C2');
 assert.equal(formatFormula(compileFormula('="A1"&A1',columns,rows),columns,rows),'="A1"&A1');
});
test('copy outside the grid produces an explicit REF error, not the old reference',()=>{
 const formula=compileFormula('=B1',columns,rows),next=translateFormulaForCopy(formula,rows[1].id,columns[1].id,rows[0].id,columns[1].id,rows,columns);
 assert.match(next,/#REF!/);
 assert.equal(evaluateDatasetFormulas(rows,columns,[{rowId:rows[0].id,columnId:columns[4].id,expression:next}]).get(formulaKey(rows[0].id,columns[4].id)),'#REF!');
});
for(const [formula,expected] of [
 ['=AVERAGE(B1:B3)',20],['=COUNTA(A1:A3)',3],['=COUNTIF(B1:B3,">15")',2],['=SUMIF(B1:B3,">15",C1:C3)',10],['=AVERAGEIF(B1:B3,">15",C1:C3)',5],
 ['=IFERROR(1/0,42)',42],['=AND(B1>1,B2>10)',true],['=OR(FALSE,B1=10)',true],['=NOT(FALSE)',true],
 ['=VLOOKUP("two",A1:C3,3,FALSE)',4],['=XLOOKUP("three",A1:A3,C1:C3)',6],['=INDEX(A1:C3,2,2)',20],['=MATCH(20,B1:B3,0)',2],
 ['=UPPER(TRIM("  hello  world "))','HELLO WORLD'],['=LEFT("abcdef",3)&RIGHT("abcdef",2)','abcef'],['=MID("abcdef",2,3)','bcd'],['=TEXTJOIN("-",TRUE,A1:A3)','one-two-three'],
 ['=ROUNDUP(-1.23,1)',-1.3],['=ROUNDDOWN(1.29,1)',1.2],['=MOD(-3,2)',1],['=DATE(2026,10,18)','2026-10-18'],['=YEAR("2026-10-18")',2026],
 ['=INDEX(A1:C3,1,4)','#REF!'],['=SUM(A1:C1)',12],['=SQRT(-1)','#NUM!'],['=XLOOKUP("missing",A1:A3,C1:C3,"none")','none'],
])test(`formula ${formula}`,()=>assert.equal(evalFormula(formula),expected));
test('cut retargets inbound references, preserving absolute flags and literal strings',()=>{
 const expression=compileFormula('=$B$1+LEN("B1")',columns,rows);
 const moved=retargetFormula(expression,new Map([[formulaKey(rows[0].id,columns[1].id),{rowId:rows[1].id,columnId:columns[2].id}]]));
 assert.equal(formatFormula(moved,columns,rows),'=$C$2+LEN("B1")');
});
test('TSV round-trips quoted tabs, embedded newlines, quotes and empty cells',()=>{
 const matrix=[['a\tb','x\ny','"q"',''],['','last','','']];assert.deepEqual(parseSheetTsv(sheetTsv(matrix)),matrix);
 assert.deepEqual(parseSheetTsv('a\tb\r\nc\td\r\n'),[['a','b'],['c','d']]);
 assert.throws(()=>parseSheetTsv('"unfinished'),/кавычка/);
});
test('types reject invalid values without coercing text identifiers or invalid dates',()=>{
 assert.equal(parseSheetInput('001',{...columns[0],dataType:'TEXT'}),'001');assert.equal(parseSheetInput('1,25',{...columns[0],dataType:'NUMBER'}),1.25);
 assert.throws(()=>parseSheetInput('invalid',{...columns[0],dataType:'NUMBER'}));assert.throws(()=>parseSheetInput('2026-02-31',{...columns[0],dataType:'DATE'}));
 assert.equal(parseSheetInput('false',{...columns[0],dataType:'BOOLEAN'}),false);
});
test('typed view filters, conditional rules and selection statistics leave stored values unchanged',()=>{
 assert.equal(matchesSheetFilter(20,'>15'),true);assert.equal(matchesSheetFilter(20,'<=15'),false);
 const source=structuredClone(rows);const result=sheetConditionalFormat(rows[1],columns[1].id,[{id:'r',columnId:columns[1].id,operator:'gt',value:'15',background:'#ff0000'}],rows);
 assert.equal(result.background,'#ff0000');assert.deepEqual(rows,source);assert.deepEqual(sheetSelectionSummary([1,2,null,'hello']),{count:3,numbers:2,sum:3,average:1.5});
});
test('simultaneous edits in different cells of one row and local undo preserve remote values',()=>{
 const a=new Y.Doc(),b=new Y.Doc(),left=new Store(a,'rows'),right=new Store(b,'rows');left.set(rows[0].id,rows[0]);Y.applyUpdate(b,Y.encodeStateAsUpdate(a));const undo=new Y.UndoManager(left.type);
 left.set(rows[0].id,{...left.get(rows[0].id),values:{...left.get(rows[0].id).values,[columns[1].id]:100}});
 right.set(rows[0].id,{...right.get(rows[0].id),values:{...right.get(rows[0].id).values,[columns[2].id]:200}});
 Y.applyUpdate(a,Y.encodeStateAsUpdate(b),'remote');undo.undo();assert.equal(left.get(rows[0].id).values[columns[1].id],10);assert.equal(left.get(rows[0].id).values[columns[2].id],200);
});
