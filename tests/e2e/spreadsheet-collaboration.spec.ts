import { test,expect } from '@playwright/test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { CanvasNodeStore } from '../../packages/shared/src/canvasDocument';
import { compileFormula } from '../../packages/shared/src/formulas';
const workspace='20000000-0000-0000-0000-000000000001';
test('dataset concurrent cells, local undo, read-only enforcement and durable formulas',async({request})=>{
 const users=await(await request.get('http://localhost:3001/api/auth/dev-users')).json();const tokens:Record<string,string>={};
 for(const user of users)tokens[user.role]=(await(await request.post('http://localhost:3001/api/auth/dev-login',{data:{userId:user.id}})).json()).token;
 const headers={Authorization:`Bearer ${tokens.OWNER}`},columns=['A','B','C'].map((name,ordinal)=>({id:randomUUID(),name,ordinal,dataType:'NUMBER'}));
 const row={id:randomUUID(),ordinal:0,values:{[columns[0].id]:1,[columns[1].id]:2}};
 const dataset=await(await request.post(`http://localhost:3001/api/workspaces/${workspace}/datasets`,{headers,data:{name:`Collab sheet ${Date.now()}`,columns,rows:[row]}})).json();
 const storageMessages:any[]=[];
 const clients:Array<{doc:Y.Doc;provider:HocuspocusProvider}>=[];
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL??'postgresql://modelboard:modelboard@localhost:5432/modelboard'});
 const connect=async(role:string)=>{
  const doc=new Y.Doc();let provider:HocuspocusProvider;
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('dataset sync timeout')),10000);provider=new HocuspocusProvider({url:'ws://localhost:1234',name:`dataset:${dataset.id}`,document:doc,token:tokens[role],WebSocketPolyfill:WebSocket,onStateless:({payload})=>{storageMessages.push(JSON.parse(payload));},onSynced:({state})=>{if(state){clearTimeout(timer);resolve();}},onAuthenticationFailed:({reason})=>{clearTimeout(timer);reject(new Error(reason));}});});
  const client={doc,provider:provider!};clients.push(client);return client;
 };
 try{
  const owner=await connect('OWNER'),editor=await connect('EDITOR'),a=new CanvasNodeStore(owner.doc,'rows'),b=new CanvasNodeStore(editor.doc,'rows');
  const undo=new Y.UndoManager(a.type);
  owner.provider.disconnect();await expect.poll(()=>owner.provider.configuration.websocketProvider.status).toBe('disconnected');
  a.set(row.id,{...a.get(row.id),values:{...a.get(row.id).values,[columns[0].id]:10}});
  b.set(row.id,{...b.get(row.id),values:{...b.get(row.id).values,[columns[1].id]:20}});
  await owner.provider.connect();await expect.poll(()=>a.get(row.id).values[columns[1].id]).toBe(20);await expect.poll(()=>b.get(row.id).values[columns[0].id]).toBe(10);
  undo.undo();await expect.poll(()=>b.get(row.id).values[columns[0].id]).toBe(1);expect(a.get(row.id).values[columns[1].id]).toBe(20);
  const key=`${row.id}:${columns[2].id}`;owner.doc.getMap('formulas').set(key,{rowId:row.id,columnId:columns[2].id,expression:compileFormula('=SUM(A1:B1)',columns as any,[row])});
  for(const role of ['VIEWER','COMMENTER']){
   const restricted=await connect(role);new CanvasNodeStore(restricted.doc,'rows').set(row.id,{...row,values:{[columns[0].id]:999}});
   const denied=await request.post(`http://localhost:3001/api/datasets/${dataset.id}/rows/batch`,{headers:{Authorization:`Bearer ${tokens[role]}`},data:{rows:[{id:randomUUID(),values:{}}]}});expect(denied.status()).toBe(403);
  }
  await expect.poll(async()=>(await pool.query('SELECT values FROM dataset_rows WHERE id=$1',[row.id])).rows[0]?.values[columns[2].id]).toBe(21);
  expect(a.get(row.id).values[columns[0].id]).toBe(1);expect(a.get(row.id).values[columns[1].id]).toBe(20);
  // A rejected projection must retain both the preceding SQL values and CRDT snapshot.
  const invalidKey=`${randomUUID()}:${columns[0].id}`;
  owner.doc.getMap('formulas').set(invalidKey,{rowId:invalidKey.split(':')[0],columnId:columns[0].id,expression:'=1'});
  await expect.poll(()=>storageMessages.some(message=>message.type==='dataset-storage'&&!message.saved)).toBeTruthy();
  expect((await pool.query('SELECT values FROM dataset_rows WHERE id=$1',[row.id])).rows[0].values[columns[2].id]).toBe(21);
  const snapshot=new Y.Doc();Y.applyUpdate(snapshot,(await pool.query('SELECT state FROM collab_documents WHERE document_name=$1',[`dataset:${dataset.id}`])).rows[0].state);expect(snapshot.getMap('formulas').has(invalidKey)).toBeFalsy();snapshot.destroy();
  storageMessages.length=0;owner.doc.getMap('formulas').delete(invalidKey);
  await expect.poll(()=>storageMessages.some(message=>message.type==='dataset-storage'&&message.saved)).toBeTruthy();

  for(const client of clients){client.provider.destroy();client.doc.destroy();}clients.length=0;
  await expect.poll(async()=>(await pool.query('SELECT octet_length(state) AS size FROM collab_documents WHERE document_name=$1',[`dataset:${dataset.id}`])).rows[0]?.size??0).toBeGreaterThan(0);
  const fresh=await connect('OWNER');expect(new CanvasNodeStore(fresh.doc,'rows').get(row.id).values[columns[1].id]).toBe(20);expect(fresh.doc.getMap('formulas').has(key)).toBeTruthy();
 }finally{for(const client of clients){client.provider.destroy();client.doc.destroy();}await pool.query('DELETE FROM datasets WHERE id=$1',[dataset.id]);await pool.end();}
});
