import { test, expect } from '@playwright/test';
const workspace = '20000000-0000-0000-0000-000000000001';
let boardId: string;
let ownerToken: string;
test.beforeEach(async ({ request, page }) => {
  const users = await (await request.get('http://localhost:3001/api/auth/dev-users')).json();
  const owner = users.find((u: any) => u.role === 'OWNER');
  ownerToken = (await (await request.post('http://localhost:3001/api/auth/dev-login', { data: { userId: owner.id } })).json()).token;
  const result = await request.post(`http://localhost:3001/api/workspaces/${workspace}/boards`, {
    headers: { Authorization: `Bearer ${ownerToken}` }, data: { name: `Canvas acceptance ${Date.now()}` },
  });
  expect(result.ok()).toBeTruthy(); boardId = (await result.json()).id;
  await page.addInitScript(id => localStorage.setItem('modelboard:last-board', id), boardId);
  await page.goto('/'); await page.getByRole('button').filter({ hasText: 'OWNER' }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
});
test.afterEach(async ({ request }) => {
  if (boardId) await request.delete(`http://localhost:3001/api/boards/${boardId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
});

// Measure frame time without tracing screencasts, retaining failure screenshots.
test.use({ trace: 'off' });
test('100 objects, history, navigation and read-only role', async ({page,browser})=>{
  await page.getByTitle('Инфраструктура',{exact:true}).click();await page.getByRole('button',{name:'Сервер',exact:true}).click();
  const server = page.locator('.react-flow__node-device');
  await server.hover();
  const ports = await server.locator('.canvas-port').evaluateAll(elements=>elements.map(element=>{
    const box=element.getBoundingClientRect();
    return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===element;
  }));
  expect(ports).toEqual([true,true,true,true]);
  await page.locator('.react-flow__pane').click({position:{x:100,y:100}});
  for(let i=0;i<7;i++) {await page.keyboard.press('Control+a');await page.keyboard.press('Control+d');await expect(page.locator('.react-flow__node-device')).toHaveCount(2**(i+1));}
  await page.keyboard.press('Control+a');
  await page.getByRole('button',{name:'Выровнять',exact:true}).click();
  await page.getByRole('button',{name:'По верхнему краю',exact:true}).click();
  await page.keyboard.press('Control+z');await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+0');
  const viewer=await browser.newPage();await viewer.addInitScript(id=>localStorage.setItem('modelboard:last-board',id),boardId);
  await viewer.goto('/');await viewer.getByRole('button').filter({hasText:'VIEWER'}).click();
  await expect(viewer.locator('.react-flow__node-device')).toHaveCount(128);
  await expect(viewer.getByTitle('Фигура',{exact:true})).toBeDisabled();
  await viewer.keyboard.press('Control+a');await viewer.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node-device')).toHaveCount(128);
  await viewer.keyboard.press('h');await viewer.mouse.move(400,400);await viewer.mouse.down();await viewer.mouse.move(500,450,{steps:10});await viewer.mouse.up();
  await viewer.close();
  await page.bringToFront();
  await page.keyboard.press('h');
  await page.mouse.move(450,350);
  await expect(page.locator('.react-flow__resize-control')).toHaveCount(0);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const viewportBefore = await page.locator('.react-flow__viewport').getAttribute('style');
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Performance.enable');
  const baseline = new Map((await profiler.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
  const timing=page.evaluate(async()=>{
    const times:number[]=[];let previous=performance.now();
    for(let i=0;i<30;i++) await new Promise<void>(resolve=>requestAnimationFrame((time)=>{times.push(time-previous);previous=time;resolve();}));
    return {average:times.reduce((a,b)=>a+b,0)/times.length,max:Math.max(...times)};
  });
  await page.mouse.down();await page.mouse.move(750,550,{steps:30});await page.mouse.up();
  const frameTimes=await timing;
  const metrics = (await profiler.send('Performance.getMetrics')).metrics;
  console.log('128-object-cpu-timing',JSON.stringify(Object.fromEntries(metrics.filter(metric=>['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].includes(metric.name)).map(metric=>[metric.name,metric.value-(baseline.get(metric.name)??0)]))));
  await profiler.detach();
  console.log('128-object-frame-timing',JSON.stringify(frameTimes));
  await test.info().attach('128-object-frame-timing',{body:JSON.stringify(frameTimes),contentType:'application/json'});
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(viewportBefore);
  expect(frameTimes.average).toBeLessThan(50);
  await page.keyboard.press('v');
});
