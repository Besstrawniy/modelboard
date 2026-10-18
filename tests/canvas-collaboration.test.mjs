import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { CanvasNodeStore, normalizeCanvasNodes } from '../packages/shared/src/canvasDocument.ts';
const node={id:'node',type:'shape',position:{x:10,y:20},data:{text:'original',fill:'#ffffff'},zIndex:0};
const sync=(a,b)=>{const aa=Y.encodeStateAsUpdate(a),bb=Y.encodeStateAsUpdate(b);Y.applyUpdate(a,bb);Y.applyUpdate(b,aa);};
test('simultaneous text, movement and style edits merge without replacing the whole object',()=>{
 const a=new Y.Doc(),b=new Y.Doc();const left=new CanvasNodeStore(a),right=new CanvasNodeStore(b);
 left.set('node',node);sync(a,b);
 left.set('node',{...left.get('node'),position:{x:90,y:80}});
 right.set('node',{...right.get('node'),data:{...right.get('node').data,text:'edited',fill:'#ff0000'}});
 sync(a,b);
 for(const store of [left,right]) {assert.deepEqual(store.get('node').position,{x:90,y:80});assert.equal(store.get('node').data.text,'edited');assert.equal(store.get('node').data.fill,'#ff0000');}
});
test('undoing a local move retains concurrent remote text and style edits',()=>{
 const a=new Y.Doc(),b=new Y.Doc();const left=new CanvasNodeStore(a),right=new CanvasNodeStore(b);
 left.set('node',node);sync(a,b);const history=new Y.UndoManager(left.type);
 left.set('node',{...left.get('node'),position:{x:100,y:200}});
 right.set('node',{...right.get('node'),data:{...right.get('node').data,text:'remote'}});
 Y.applyUpdate(a,Y.encodeStateAsUpdate(b),'remote-provider');history.undo();
 assert.deepEqual(left.get('node').position,node.position);assert.equal(left.get('node').data.text,'remote');
});
test('legacy snapshots migrate without changing object IDs/content, and remote deletion wins',()=>{
 const a=new Y.Doc();a.getMap('nodes').set('node',node);normalizeCanvasNodes(a);
 const left=new CanvasNodeStore(a);assert.deepEqual(left.get('node'),node);
 const b=new Y.Doc();Y.applyUpdate(b,Y.encodeStateAsUpdate(a));const right=new CanvasNodeStore(b);
 left.set('node',{...left.get('node'),position:{x:1,y:1}});right.delete('node');sync(a,b);
 assert.equal(left.has('node'),false);assert.equal(right.has('node'),false);
});
test('cached snapshots change only when their own object changes, observers see nested edits',()=>{
 const doc=new Y.Doc(),store=new CanvasNodeStore(doc);store.set('node',node);store.set('other',{...node,id:'other'});
 const first=store.get('node');let calls=0;const listener=()=>calls++;store.observe(listener);
 store.set('other',{...store.get('other'),data:{text:'changed'}});assert.equal(store.get('node'),first);
 store.set('node',{...first,data:{...first.data,text:'updated'}});assert.equal(store.get('node').data.text,'updated');assert.equal(calls,2);
 store.unobserve(listener);
});
