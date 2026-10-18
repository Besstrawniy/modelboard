import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeCanvasNode, canvasNodeStroke } from '../apps/web/src/lib/canvasStrokes.ts';
import { snapCanvasGuides } from '../apps/web/src/lib/canvasGuides.ts';
const stroke={id:'stroke',points:[{x:10,y:20},{x:110,y:70}],width:3,color:'#123456',createdBy:'owner'};
test('stroke objects round-trip board coordinates, including negative space and single points',()=>{
 for(const source of [stroke,{...stroke,points:[{x:-200,y:-50}]}]) {
  const node=strokeCanvasNode(source);
  assert.deepEqual(canvasNodeStroke(node),source);
  assert.ok(node.style.width>0&&node.style.height>0);
 }
});
test('moving, resizing and rotating a stroke preserves its source samples',()=>{
 const node=strokeCanvasNode(stroke),before=structuredClone(node);
 const moved=canvasNodeStroke({...node,position:{x:node.position.x+50,y:node.position.y-20}});
 assert.deepEqual(moved.points[0],{x:60,y:0});
 const scaled=canvasNodeStroke({...node,width:node.style.width*2,height:node.style.height*2});
 assert.equal(scaled.points[1].x-scaled.points[0].x,200);
 const rotated=canvasNodeStroke({...node,data:{...node.data,rotation:180}});
 assert.ok(Math.abs(rotated.points[1].x-rotated.points[0].x+100)<1e-8);
 assert.deepEqual(node,before);
});
test('smart guides snap edges and centres within a screen-space threshold',()=>{
 const other={id:'other',position:{x:200,y:300},width:100,height:80};
 const node={id:'moving',position:{x:102,y:251},width:100,height:50};
 const result=snapCanvasGuides(node,[other],1);
 assert.deepEqual(result.position,{x:100,y:250});assert.equal(result.guides.length,2);
 const far=snapCanvasGuides({...node,position:{x:110,y:260}},[other],2);
 assert.deepEqual(far.guides,[]);
 assert.deepEqual(node.position,{x:102,y:251});
});
