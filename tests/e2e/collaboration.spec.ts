import { test, expect } from '@playwright/test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import pg from 'pg';
import { CanvasNodeStore } from '../../packages/shared/src/canvasDocument';
const workspace='20000000-0000-0000-0000-000000000001';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('two writers, hostile read-only clients, disconnect persistence and fresh reload',async({request})=>{
 const users=await (await request.get('http://localhost:3001/api/auth/dev-users')).json();
 const tokens:Record<string,string>={};
 for(const user of users) tokens[user.role]=(await (await request.post('http://localhost:3001/api/auth/dev-login',{data:{userId:user.id}})).json()).token;
 const headers={Authorization:`Bearer ${tokens.OWNER}`};
 const board=await (await request.post(`http://localhost:3001/api/workspaces/${workspace}/boards`,{headers,data:{name:`Collab test ${Date.now()}`}})).json();
 const clients:{doc:Y.Doc;provider:HocuspocusProvider}[]=[];
 const connect=async(role:string)=>{
  const doc=new Y.Doc();let provider:HocuspocusProvider;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('sync timeout')),10000);
   provider=new HocuspocusProvider({url:'ws://localhost:1234',name:`board:${board.id}`,document:doc,token:tokens[role],WebSocketPolyfill:WebSocket,
    onSynced:({state})=>{if(state){clearTimeout(timer);resolve();}},onAuthenticationFailed:({reason})=>{clearTimeout(timer);reject(new Error(reason));}});
  });
  const client={doc,provider:provider!};clients.push(client);return client;
 };
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL??'postgresql://modelboard:modelboard@localhost:5432/modelboard'});
 try {
  const owner=await connect('OWNER'),editor=await connect('EDITOR');
  owner.doc.getMap('nodes').set('owner-node',{id:'owner-node',type:'shape',position:{x:10,y:20},data:{text:'Owner'}});
  editor.doc.getMap('nodes').set('editor-node',{id:'editor-node',type:'shape',position:{x:40,y:60},data:{text:'Editor'}});
  await expect.poll(()=>owner.doc.getMap('nodes').size).toBe(2);
  await expect.poll(()=>editor.doc.getMap('nodes').size).toBe(2);
  const ownStore = new CanvasNodeStore(owner.doc), editorStore = new CanvasNodeStore(editor.doc);
  // Upgrade a legacy object once, then concurrently edit independent fields offline.
  ownStore.set('owner-node', {...ownStore.get('owner-node'), data:{text:'Owner'}});
  await expect.poll(()=>editor.doc.getMap('nodes').get('owner-node') instanceof Y.Map).toBeTruthy();
  owner.provider.disconnect();
  await expect.poll(()=>owner.provider.configuration.websocketProvider.status).toBe('disconnected');
  ownStore.set('owner-node', {...ownStore.get('owner-node'), position:{x:500,y:600}});
  editorStore.set('owner-node', {...editorStore.get('owner-node'), data:{text:'Edited concurrently'}});
  ownStore.set('offline-node',{id:'offline-node',type:'shape',position:{x:0,y:0},data:{text:'Offline'}});
  editorStore.set('online-node',{id:'online-node',type:'shape',position:{x:0,y:0},data:{text:'Online'}});
  await owner.provider.connect();
  await expect.poll(()=>ownStore.size).toBe(4);await expect.poll(()=>editorStore.size).toBe(4);
  await expect.poll(()=>ownStore.get('owner-node').data.text).toBe('Edited concurrently');
  await expect.poll(()=>editorStore.get('owner-node').position.x).toBe(500);
  for(const role of ['VIEWER','COMMENTER']) {
   const restricted=await connect(role);expect(restricted.doc.getMap('nodes').size).toBe(4);
   restricted.doc.getMap('nodes').set(`forbidden-${role}`,{id:`forbidden-${role}`,position:{x:0,y:0},data:{}});
   await delay(250);expect(owner.doc.getMap('nodes').size).toBe(4);
  }
  const denied=await request.post(`http://localhost:3001/api/workspaces/${workspace}/boards`,{headers:{Authorization:`Bearer ${tokens.VIEWER}`},data:{name:'forbidden'}});
  expect(denied.status()).toBe(403);
  for(const client of clients){client.provider.destroy();client.doc.destroy();}clients.length=0;
  await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM board_object_index WHERE board_id=$1',[board.id])).rows[0].count)).toBe(4);
  await expect.poll(async()=>(await pool.query('SELECT octet_length(state) AS size FROM collab_documents WHERE document_name=$1',[`board:${board.id}`])).rows[0]?.size??0).toBeGreaterThan(0);
  const restored=await connect('OWNER');expect(restored.doc.getMap('nodes').size).toBe(4);
  const persisted = new CanvasNodeStore(restored.doc).get('owner-node');
  expect(persisted.data.text).toBe('Edited concurrently');expect(persisted.position).toEqual({x:500,y:600});
 }finally {
  for(const client of clients){client.provider.destroy();client.doc.destroy();}
  await pool.end();await request.delete(`http://localhost:3001/api/boards/${board.id}`,{headers});
 }
});
