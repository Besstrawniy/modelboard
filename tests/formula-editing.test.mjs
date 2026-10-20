import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaReferences, formulaSuggestions, formulaReferenceStyle } from '../apps/web/src/lib/formulaEditing.ts';
test('formula editing highlights absolute references and reversed ranges without matching strings or function names',()=>{
 const refs=formulaReferences('=SUM($B$4:A2)+C3+"D4"+[A1]+LOG10(10)',10,5);
 assert.equal(refs.length,2);
 assert.deepEqual({...refs[0],color:undefined},{startRow:1,endRow:3,startColumn:0,endColumn:1,color:undefined});
 assert.notEqual(refs[0].color,refs[1].color);
 assert.match(formulaReferenceStyle(refs,1,0).boxShadow,/inset 0 2px/);
 assert.deepEqual(formulaReferenceStyle(refs,9,4),{});
 assert.equal(formulaReferences('=A0+Z999',10,5).length,0);
});
test('formula suggestions follow the token being typed and provide useful syntax',()=>{
 assert.deepEqual(formulaSuggestions('hello'),[]);
 assert.equal(formulaSuggestions('=SU')[0][0],'SUM');
 assert.equal(formulaSuggestions('=A1+AVE')[0][0],'AVERAGE');
 assert.deepEqual(formulaSuggestions('=SUM(A1:A4)'),[]);
});
test('Russian formula suggestions include translated syntax and nested functions',()=>{
 assert.equal(formulaSuggestions('=су')[0][0],'СУММ');
 assert.equal(formulaSuggestions('=ЕС')[0][0],'ЕСЛИ');
 assert.match(formulaSuggestions('=ЕС')[0][1],/^ЕСЛИ\(/);
 assert.equal(formulaSuggestions('=ЕСЛИ(A1;СУММЕС')[0][0],'СУММЕСЛИ');
 assert.equal(new Set(formulaSuggestions('=СР').map(item=>item[0])).size,formulaSuggestions('=СР').length);
});
