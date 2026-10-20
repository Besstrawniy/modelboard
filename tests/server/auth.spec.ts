import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

test('server requires credentials, blocks demo tokens, and serves the favicon', async ({ request, page, baseURL }) => {
  expect(await (await request.get('/api/auth/config')).json()).toEqual({mode:'password'});
  expect((await request.get('/api/auth/dev-users')).status()).toBe(404);
  expect((await request.post('/api/auth/dev-login',{data:{userId:'10000000-0000-0000-0000-000000000001'}})).status()).toBe(404);
  for (const data of [
    {email:'owner@example.local',password:'wrong'},
    {email:'viewer@example.local',password:''},
    {email:'missing@example.local',password:'ci_owner_password_012345'},
    {userId:'10000000-0000-0000-0000-000000000001',role:'OWNER'},
  ]) expect((await request.post('/api/auth/login',{data})).status()).toBe(401);
  const oldToken = jwt.sign({sub:'10000000-0000-0000-0000-000000000001',email:'owner@example.local',displayName:'Owner'},
    'ci_server_jwt_key_only_for_isolated_tests_0123456789',{expiresIn:'1h'});
  expect((await request.get('/api/boards/30000000-0000-0000-0000-000000000001',{headers:{Authorization:'Bearer '+oldToken}})).status()).toBe(401);
  // Hocuspocus receives an old-style signed demo JWT and must reject authentication.
  const url = baseURL!.replace(/^http/,'ws')+'/collab';
  const authResult = await new Promise<string>((resolve,reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('Authentication response timed out')); }, 8000);
    const finish = (result:string) => { clearTimeout(timeout); socket.close(); resolve(result); };
    socket.on('open', () => {
      // y-protocols: document name, auth message(2), token subtype(0), token string.
      const string = (value:string) => {
        const bytes=Buffer.from(value), prefix:number[]=[]; let size=bytes.length;
        while(size>127){prefix.push((size&127)|128);size>>>=7;}prefix.push(size);
        return Buffer.concat([Buffer.from(prefix),bytes]);
      };
      socket.send(Buffer.concat([string('board:30000000-0000-0000-0000-000000000001'),Buffer.from([2,0]),string(oldToken)]));
    });
    socket.on('message', data => {
      const bytes=Buffer.from(data as Buffer);let index=0;
      const uint=()=>{let result=0,shift=0,value=0;do{value=bytes[index++];result|=(value&127)<<shift;shift+=7;}while(value&128);return result;};
      const length=uint();index+=length;
      if(uint()===2) finish(uint()===1?'denied':'authenticated');
    });
    socket.on('close', () => finish('closed'));
    socket.on('error', reject);
  });
  expect(['denied','closed']).toContain(authResult);
  const editor = await request.post('/api/auth/login',{data:{
    email:'editor@example.local',password:'ci_editor_password_012345',role:'OWNER',
    userId:'10000000-0000-0000-0000-000000000001',
  }});
  expect(editor.ok()).toBeTruthy();
  const editorToken=(await editor.json()).token;
  const board=await request.get('/api/boards/30000000-0000-0000-0000-000000000001',{headers:{Authorization:'Bearer '+editorToken}});
  expect((await board.json()).role).toBe('EDITOR');
  expect((await request.delete('/api/boards/30000000-0000-0000-0000-000000000001',{headers:{Authorization:'Bearer '+editorToken}})).status()).toBe(403);
  await page.goto(baseURL!);
  await expect(page.getByLabel('Пароль',{exact:true})).toHaveAttribute('type','password');
  await expect(page.locator('.demo-users')).toHaveCount(0);
  const icon = await request.get('/favicon.svg');
  expect(icon.ok()).toBeTruthy();
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(await icon.text()).toContain('<svg');
});
