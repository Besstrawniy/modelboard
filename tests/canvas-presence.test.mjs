import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCanvasPresence } from '../apps/web/src/lib/canvasPresence.ts';
const user = {id:'editor',name:'Editor',role:'EDITOR'};
test('Hocuspocus local cursor updates do not add a duplicate participant or trigger rendering', () => {
  const current = [];
  for (let x = 0; x < 100; x++) assert.equal(reconcileCanvasPresence(current,
    [{clientId:12345,user,cursor:{x,y:10}}],12345),current);
});
test('remote client IDs survive array reordering and cloned equivalent awareness states', () => {
  const states = [{clientId:42,user,cursor:{x:1,y:2}},{clientId:99,user,cursor:null},{clientId:12345,user}];
  const current = reconcileCanvasPresence([],states,12345);
  assert.deepEqual(current.map(([id])=>id),[42,99]);
  assert.equal(reconcileCanvasPresence(current,structuredClone(states).reverse(),12345),current);
});
test('remote cursor movement, user changes, cursor hiding and departures reach the canvas', () => {
  const current = reconcileCanvasPresence([],[{clientId:42,user,cursor:{x:1,y:2}}],12345);
  const moved = reconcileCanvasPresence(current,[{clientId:42,user,cursor:{x:3,y:4}}],12345);
  assert.notEqual(moved,current); assert.deepEqual(moved[0][1].cursor,{x:3,y:4});
  assert.notEqual(reconcileCanvasPresence(moved,[{clientId:42,user:{...user,name:'Renamed'},cursor:{x:3,y:4}}],12345),moved);
  assert.equal(reconcileCanvasPresence(moved,[{clientId:42,user,cursor:null}],12345)[0][1].cursor,null);
  assert.deepEqual(reconcileCanvasPresence(moved,[],12345),[]);
});
