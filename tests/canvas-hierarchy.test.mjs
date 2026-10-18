import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasDescendants, moveCanvasDescendants, enclosingCanvasFrame, canvasSelectionRoots } from '../apps/web/src/lib/canvasHierarchy.ts';
const node=(id,x,y,container,type='shape')=>({id,type,position:{x,y},width:100,height:100,data:{containerId:container}});
test('nested ownership moves and deletes only explicit descendants, never overlapping neighbours',()=>{
 const nodes=[node('frame',0,0,undefined,'frame'),node('group',10,10,'frame','group'),node('child',20,20,'group'),node('neighbour',20,20)];
 assert.deepEqual([...canvasDescendants(nodes,new Set(['frame']))],['frame','group','child']);
 const result=moveCanvasDescendants(nodes,new Map([['frame',{x:50,y:80}]]));
 assert.deepEqual(result.get('child'),{x:70,y:100});assert.equal(result.has('neighbour'),false);
 assert.deepEqual(canvasSelectionRoots(nodes,new Set(['frame','group','child'])).map(n=>n.id),['frame']);
});
test('frame attachment requires complete containment and cannot create cycles',()=>{
 const frame={...node('frame',0,0,undefined,'frame'),width:400,height:400};
 const inner={...node('inner',10,10,'frame','frame'),width:200,height:200},child=node('child',20,20,'inner');
 assert.equal(enclosingCanvasFrame([frame,inner,child],new Set(['child'])).id,'inner');
 assert.equal(enclosingCanvasFrame([frame,inner,child],new Set(['frame'])),undefined);
 assert.equal(enclosingCanvasFrame([frame,node('outside',350,350)],new Set(['outside'])),undefined);
});
test('corrupt cyclic ownership terminates rather than hanging the canvas',()=>{
 const nodes=[node('a',0,0,'b','group'),node('b',0,0,'a','group')];
 assert.equal(canvasDescendants(nodes,new Set(['a'])).size,2);
});
