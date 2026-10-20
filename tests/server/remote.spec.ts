import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const workspace='20000000-0000-0000-0000-000000000001';
test('two independent browsers edit canvas and dataset through the built server address',async({browser,request,baseURL},info)=>{
  const response=await request.post('/api/auth/login',{data:{email:'owner@example.local',password:'ci_owner_password_012345'}});
  expect(response.ok()).toBeTruthy();
  const token=(await response.json()).token;
  const headers={Authorization:'Bearer '+token};
  const boardResponse=await request.post('/api/workspaces/'+workspace+'/boards',{headers,data:{name:'Remote access '+Date.now()}});
  expect(boardResponse.ok()).toBeTruthy();
  const board=await boardResponse.json();
  const colText=randomUUID(),colNumber=randomUUID(),row=randomUUID();
  const datasetResponse=await request.post('/api/workspaces/'+workspace+'/datasets',{headers,data:{
    name:'Remote dataset '+randomUUID().slice(0,8),
    columns:[{id:colText,name:'name',dataType:'TEXT',ordinal:0},{id:colNumber,name:'amount',dataType:'NUMBER',ordinal:1}],
    rows:[{id:row,ordinal:0,values:{[colText]:'Initial',[colNumber]:10}}],
  }});
  expect(datasetResponse.ok()).toBeTruthy();const dataset=await datasetResponse.json();
  const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1440,height:1000}})]);
  const pages=await Promise.all(contexts.map(context=>context.newPage()));
  const network:string[]=[],errors:string[]=[];
  for(const page of pages){
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>network.push(request.url()));
    page.on('websocket',socket=>network.push(socket.url()));
  }
  const login=async(page:Page,role:string)=>{
    // Also exercise the missing API when this test is run on localhost.
    await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', {value:undefined,configurable:true}));
    await page.addInitScript(id=>localStorage.setItem('modelboard:last-board',id),board.id);
    await page.goto(baseURL!);
    if(new URL(baseURL!).hostname==='modelboard.test') expect(await page.evaluate(()=>window.isSecureContext)).toBe(false);
    expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
    await page.getByLabel('Email',{exact:true}).fill(role.toLowerCase()+'@example.local');
    await page.getByLabel('Пароль',{exact:true}).fill(role==='OWNER'?'ci_owner_password_012345':'ci_editor_password_012345');
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(page.locator('.connection-status')).toHaveText('connected');
  };
  try{
    await Promise.all([login(pages[0],'OWNER'),login(pages[1],'EDITOR')]);
    const [first,second]=pages;
    await first.getByTitle('Фигура',{exact:true}).click();
    await first.locator('.react-flow__pane').click({position:{x:450,y:300}});
    for(const page of pages)await expect(page.locator('.react-flow__node-shape')).toHaveCount(1);
    await first.locator('.react-flow__node-shape .canvas-inline-text').dblclick();
    await first.locator('.react-flow__node-shape textarea').fill('Written by owner');
    await first.locator('.react-flow__node-shape textarea').press('Control+Enter');
    await expect(second.locator('.react-flow__node-shape')).toContainText('Written by owner');
    await second.locator('.react-flow__node-shape .canvas-inline-text').dblclick();
    await second.locator('.react-flow__node-shape textarea').fill('Written by editor');
    await second.locator('.react-flow__node-shape textarea').press('Control+Enter');
    await expect(first.locator('.react-flow__node-shape')).toContainText('Written by editor');
    await second.getByTitle('Стикер',{exact:true}).click();
    await second.locator('.react-flow__pane').click({position:{x:800,y:400}});
    for(const page of pages)await expect(page.locator('.react-flow__node-sticky')).toHaveCount(1);
    await first.getByTitle('Данные',{exact:true}).click();
    await first.locator('.dataset-card').filter({hasText:dataset.name}).getByRole('button',{name:'Разместить таблицу на доске',exact:true}).click();
    await first.locator('.datasets-panel header button').click();
    for(const page of pages){
      await expect(page.locator('.react-flow__node-table')).toHaveCount(1);
      await page.getByTitle('Открыть таблицу',{exact:true}).click();
      await expect(page.locator('.dataset-sheet')).toBeVisible();
    }
    const cell=(page:Page,column:string)=>page.locator('.dataset-sheet td[data-row-id="'+row+'"][data-column-id="'+column+'"] .dataset-sheet__cell-editor');
    await cell(first,colNumber).fill('23');await cell(first,colNumber).press('Enter');
    await expect(cell(second,colNumber)).toHaveValue('23');
    await cell(second,colText).fill('Shared over server');await cell(second,colText).press('Enter');
    await expect(cell(first,colText)).toHaveValue('Shared over server');
    await first.screenshot({path:info.outputPath('remote-two-participants.png')});
    const origin=new URL(baseURL!).origin,wsOrigin=origin.replace(/^http/,'ws');
    expect(network.some(url=>url.startsWith(origin+'/api/'))).toBeTruthy();
    expect(network.filter(url=>url.startsWith(wsOrigin+'/collab')).length).toBeGreaterThanOrEqual(4);
    expect(network.filter(url=>/^https?:|^wss?:/.test(url)).every(url=>new URL(url).host===new URL(baseURL!).host)).toBeTruthy();
    expect(errors).toEqual([]);
  }finally{
    await Promise.all(contexts.map(context=>context.close()));
    await request.delete('/api/boards/'+board.id,{headers});
    await request.delete('/api/datasets/'+dataset.id,{headers});
  }
});
