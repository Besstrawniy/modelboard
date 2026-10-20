import { test,expect,type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
const workspace='20000000-0000-0000-0000-000000000001';
let boardId:string,datasetId:string,token:string,name:string,columns:any[],rows:any[];
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL??'postgresql://modelboard:modelboard@localhost:5432/modelboard'});
const sheet=(page:Page)=>page.locator('.dataset-sheet');
const cell=(page:Page,r:number,c:number)=>sheet(page).locator(`td[data-row-id="${rows[r].id}"][data-column-id="${columns[c].id}"] .dataset-sheet__cell-editor`);
async function command(page:Page,name:string){await sheet(page).locator('.sheet-command-menu > summary').click();await sheet(page).getByRole('button',{name,exact:true}).click();}
async function dataOptions(page:Page){const details=sheet(page).locator('.sheet-options');if(await details.getAttribute('open')===null)await details.locator('summary').click();}
async function openDataset(page:Page,role='OWNER'){
 await page.addInitScript(id=>localStorage.setItem('modelboard:last-board',id),boardId);await page.goto('/');await page.getByRole('button').filter({hasText:role}).click();
 await page.getByTitle('Данные',{exact:true}).click();const card=page.locator('.dataset-card').filter({hasText:name});await card.getByRole('button',{name:'Разместить таблицу на доске',exact:true}).click();await page.locator('.datasets-panel header button').click();
 await page.getByTitle('Открыть таблицу',{exact:true}).first().click();await expect(sheet(page).getByRole('grid')).toBeVisible();
}
test.beforeEach(async({request,context,page},testInfo)=>{
 page.on('dialog',dialog=>dialog.accept());
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const users=await(await request.get('http://localhost:3001/api/auth/dev-users')).json();token=(await(await request.post('http://localhost:3001/api/auth/dev-login',{data:{userId:users.find((u:any)=>u.role==='OWNER').id}})).json()).token;
 const headers={Authorization:`Bearer ${token}`};
 boardId=(await(await request.post(`http://localhost:3001/api/workspaces/${workspace}/boards`,{headers,data:{name:`Sheet test ${Date.now()}`}})).json()).id;
 columns=['name','price','qty','total'].map((name,i)=>({id:randomUUID(),name,dataType:i===0?'TEXT':'NUMBER',ordinal:i}));
 rows=Array.from({length:testInfo.title.includes('large table')?10000:20},(_,i)=>({id:randomUUID(),ordinal:i,values:{[columns[0].id]:`Item ${i+1}`,[columns[1].id]:(i+1)*10,[columns[2].id]:i+2}}));
 name=`Spreadsheet ${randomUUID().slice(0,8)}`;
 const response=await request.post(`http://localhost:3001/api/workspaces/${workspace}/datasets`,{headers,data:{name,columns,rows:rows.slice(0,2000)}});expect(response.ok()).toBeTruthy();datasetId=(await response.json()).id;
 if(rows.length>2000){const bulk=await request.post(`http://localhost:3001/api/datasets/${datasetId}/rows/batch`,{headers,data:{rows:rows.slice(2000)}});expect(bulk.ok()).toBeTruthy();}
 await openDataset(page);
});
test.afterEach(async({request,page})=>{
 await page.goto('about:blank');await request.delete(`http://localhost:3001/api/boards/${boardId}`,{headers:{Authorization:`Bearer ${token}`}});
 await pool.query('DELETE FROM datasets WHERE id=$1',[datasetId]);
});
test.afterAll(async()=>{await pool.end();});
test('typed edits, formulas, rich clipboard, cut, atomic paste/undo and validation',async({page})=>{
 await cell(page,0,3).fill('=$B$1*C1');await cell(page,0,3).press('Enter');await expect(cell(page,0,3)).toHaveValue('20');
 await cell(page,0,3).click();await sheet(page).getByTitle('Копировать выбранную ячейку/диапазон',{exact:true}).click();
 await cell(page,1,3).click();await sheet(page).getByTitle('Вставить из Excel / Google Sheets / clipboard',{exact:true}).click();await expect(cell(page,1,3)).toHaveValue('30');
 await cell(page,0,1).fill('invalid');await cell(page,0,1).press('Tab');await expect(cell(page,0,1)).toHaveAttribute('aria-invalid','true');
 await cell(page,0,1).fill('12,5');await cell(page,0,1).press('Enter');await expect(cell(page,0,3)).toHaveValue('25');
 await cell(page,0,0).click();await page.keyboard.press('Control+x');await cell(page,3,0).click();await sheet(page).getByTitle('Вставить из Excel / Google Sheets / clipboard',{exact:true}).click();await expect(cell(page,3,0)).toHaveValue('Item 1');await expect(cell(page,0,0)).toHaveValue('');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(cell(page,0,0)).toHaveValue('Item 1');
 await page.evaluate(()=>navigator.clipboard.writeText('alpha\t100\t2\nbeta\t200\t3'));
 await cell(page,0,0).click();await sheet(page).getByTitle('Вставить из Excel / Google Sheets / clipboard',{exact:true}).click();await expect(cell(page,0,0)).toHaveValue('alpha');await expect(cell(page,1,1)).toHaveValue('200');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(cell(page,0,0)).toHaveValue('Item 1');await expect(cell(page,1,1)).toHaveValue('20');
});
test('reorder, conditional rules, saved views, multiple placements and persistence',async({page},testInfo)=>{
 const headers=sheet(page).getByRole('grid').locator('thead tr').first().locator('th');await headers.nth(2).dragTo(headers.nth(3),{targetPosition:{x:170,y:20}});
 await expect.poll(async()=>(await sheet(page).locator('thead tr').first().locator('th').allTextContents()).join(' ')).toMatch(/name.*qty.*price.*total/);
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
 const rowHeaders=sheet(page).getByRole('grid').locator('tbody tr:not(.sheet-spacer) > th');await rowHeaders.nth(1).dragTo(rowHeaders.nth(0),{targetPosition:{x:20,y:2}});
 await expect(sheet(page).locator('tbody tr').first().locator('td').first().locator('.dataset-sheet__cell-editor')).toHaveValue('Item 2');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
 await dataOptions(page);await cell(page,0,1).click();await sheet(page).getByRole('button',{name:'Условное оформление',exact:true}).click();await sheet(page).getByLabel('Значение условия',{exact:true}).fill('15');await sheet(page).getByRole('button',{name:'Добавить правило',exact:true}).click();
 await expect(cell(page,1,1)).toHaveCSS('background-color','rgb(255, 224, 223)');
 await page.screenshot({path:testInfo.outputPath('spreadsheet.png')});
 await dataOptions(page);await sheet(page).getByLabel('Фильтр строк',{exact:true}).fill('Item 2');await sheet(page).getByLabel('Название представления',{exact:true}).fill('Twos');await sheet(page).getByRole('button',{name:'Сохранить вид',exact:true}).click();
 await expect(sheet(page).getByLabel('Представление таблицы',{exact:true})).not.toHaveValue('');
 await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_sheet_settings WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(1);
 await sheet(page).getByTitle('Закрыть (Esc)').click();await page.locator('.react-flow__node-table').first().getByLabel('Представление на Canvas').selectOption({label:'Twos'});
 await expect(page.locator('.react-flow__node-table').first()).toContainText('2 строк');
 await page.getByTitle('Данные',{exact:true}).click();await page.locator('.dataset-card').filter({hasText:name}).getByRole('button',{name:'Разместить таблицу на доске',exact:true}).click();await page.locator('.datasets-panel header button').click();await expect(page.locator('.react-flow__node-table')).toHaveCount(2);
 await page.getByTitle('Открыть таблицу',{exact:true}).last().click();await dataOptions(page);await expect(sheet(page).getByLabel('Представление таблицы').locator('option')).toContainText(['Все данные','Twos']);
});
test('large table virtualizes 10000 rows and supports freeze, navigation and filtering',async({page})=>{
 await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','10000');
 await expect.poll(()=>sheet(page).locator('tbody tr:not(.sheet-spacer)').count()).toBeLessThan(80);
 await cell(page,0,0).click();await sheet(page).locator('.sheet-command-menu>summary').click();await sheet(page).getByTitle('Закрепить до выбранной ячейки: не более пяти верхних строк и левых колонок').click();
 await sheet(page).locator('.dataset-sheet__viewport').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await expect(cell(page,9999,0)).toHaveValue('Item 10000');await expect(cell(page,0,0)).toBeVisible();
 await cell(page,9999,1).fill('42');await cell(page,9999,1).press('Tab');await expect(cell(page,9999,1)).toHaveValue('42');
 await dataOptions(page);await sheet(page).getByLabel('Фильтр строк',{exact:true}).fill('Item 10000');await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','1');await expect(cell(page,9999,1)).toHaveValue('42');
});
test('structural edits and bulk growth undo restore PostgreSQL state',async({page})=>{
 await cell(page,0,0).click();await command(page,'Добавить строку');
 await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','21');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','20');
 await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(20);
 await cell(page,0,0).locator("xpath=ancestor::tr").getByTitle('Удалить строку',{exact:true}).click();
 await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','19');await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(cell(page,0,0)).toHaveValue('Item 1');
 await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(20);
 await cell(page,19,0).click();await page.evaluate(()=>navigator.clipboard.writeText('first\t1\nsecond\t2\nthird\t3'));
 await sheet(page).getByTitle('Вставить из Excel / Google Sheets / clipboard',{exact:true}).click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','22');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','20');await expect(cell(page,19,0)).toHaveValue('Item 20');
 await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(20);
 await page.evaluate(()=>navigator.clipboard.writeText('valid\t1\ninvalid\tbad\nextra\t3'));
 await sheet(page).getByTitle('Вставить из Excel / Google Sheets / clipboard',{exact:true}).click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','20');await expect(cell(page,19,0)).toHaveValue('Item 20');
});
test('two browser editors share a dataset across boards and Viewer cannot edit',async({page,browser,request})=>{
 const secondBoard=(await(await request.post(`http://localhost:3001/api/workspaces/${workspace}/boards`,{headers:{Authorization:`Bearer ${token}`},data:{name:`Second sheet board ${Date.now()}`}})).json()).id;
 const editorContext=await browser.newContext(),viewerContext=await browser.newContext();
 try{
  const editor=await editorContext.newPage();await editor.addInitScript(id=>localStorage.setItem('modelboard:last-board',id),secondBoard);await editor.goto('/');await editor.getByRole('button').filter({hasText:'EDITOR'}).click();
  await editor.getByTitle('Данные',{exact:true}).click();await editor.locator('.dataset-card').filter({hasText:name}).getByRole('button',{name:'Разместить таблицу на доске',exact:true}).click();await editor.locator('.datasets-panel header button').click();await editor.getByTitle('Открыть таблицу',{exact:true}).click();
  await cell(page,0,1).fill('123');await cell(page,0,1).press('Enter');await expect(cell(editor,0,1)).toHaveValue('123');
  await cell(editor,0,2).fill('456');await cell(editor,0,2).press('Enter');await expect(cell(page,0,2)).toHaveValue('456');
  await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(cell(editor,0,1)).toHaveValue('10');await expect(cell(page,0,2)).toHaveValue('456');
  const viewer=await viewerContext.newPage();await viewer.addInitScript(id=>localStorage.setItem('modelboard:last-board',id),secondBoard);await viewer.goto('/');await viewer.getByRole('button').filter({hasText:'VIEWER'}).click();await viewer.getByTitle('Открыть таблицу',{exact:true}).click();await expect(cell(viewer,0,1)).toHaveAttribute('readonly','');await expect(sheet(viewer).getByRole('button',{name:'Вырезать',exact:true})).toHaveCount(0);
 }finally{await editorContext.close();await viewerContext.close();await request.delete(`http://localhost:3001/api/boards/${secondBoard}`,{headers:{Authorization:`Bearer ${token}`}});}
});
test('keyboard ranges, clipboard shortcuts, fill and column structure undo',async({page})=>{
 await cell(page,0,0).click();await cell(page,0,0).press('Shift+ArrowDown');await page.keyboard.press('Control+c');
 await cell(page,3,0).click();await page.keyboard.press('Control+v');await expect(cell(page,3,0)).toHaveValue('Item 1');await expect(cell(page,4,0)).toHaveValue('Item 2');
 await cell(page,0,1).click();const handle=sheet(page).locator('.dataset-sheet__fill-handle');const from=await handle.boundingBox(),to=await cell(page,1,1).boundingBox();await page.mouse.move(from!.x+3,from!.y+3);await page.mouse.down();await page.mouse.move(to!.x+10,to!.y+10,{steps:5});await page.mouse.up();await expect(cell(page,1,1)).toHaveValue('10');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(cell(page,1,1)).toHaveValue('20');
 await command(page,'Добавить колонку');const dialog=sheet(page).locator('.dataset-sheet__column-dialog');await dialog.getByLabel('Название',{exact:true}).fill('extra');await dialog.getByRole('button',{name:'Создать',exact:true}).click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-colcount','5');
 await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_columns WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(5);
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-colcount','4');await expect.poll(async()=>Number((await pool.query('SELECT count(*) FROM dataset_columns WHERE dataset_id=$1',[datasetId])).rows[0].count)).toBe(4);
 await sheet(page).getByTitle('Повторить изменение Dataset (Ctrl+Y)').click();await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-colcount','5');
});
test('review fixes: exact resize width, header drag, append and narrow table overflow',async({page})=>{
 const grid=sheet(page).getByRole('grid');
 const headers=grid.locator('thead tr').first().locator('th');
 const first=headers.nth(1),second=headers.nth(2);
 const before=await first.boundingBox();const grip=first.locator('.dataset-sheet__column-resizer');const handle=await grip.boundingBox();
 await page.mouse.move(handle!.x+handle!.width/2,handle!.y+handle!.height/2);await page.mouse.down();await page.mouse.move(handle!.x+handle!.width/2+15,handle!.y+handle!.height/2,{steps:3});await page.mouse.up();
 const after=await first.boundingBox();expect(Math.abs(after!.width-before!.width-15)).toBeLessThan(3);
 await first.dragTo(second,{targetPosition:{x:170,y:20}});
 await expect.poll(async()=>(await headers.allTextContents()).join(' ')).toMatch(/price.*name.*qty/);
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
 await command(page,'Добавить колонку');
 const dialog=sheet(page).locator('.dataset-sheet__column-dialog');await dialog.getByLabel('Название',{exact:true}).fill('last_column');await dialog.getByRole('button',{name:'Создать',exact:true}).click();
 await expect(headers.last()).toContainText('last_column');
 const viewport=page.locator('.dataset-sheet__viewport');
 expect(await viewport.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 const rowHeaders=grid.locator('tbody tr:not(.sheet-spacer) > th');
 const target=await rowHeaders.nth(1).boundingBox();
 await rowHeaders.nth(0).dragTo(rowHeaders.nth(1),{targetPosition:{x:20,y:target!.height-2}});
 await expect(grid.locator('tbody tr').first().locator('td').first().locator('.dataset-sheet__cell-editor')).toHaveValue('Item 2');
 await sheet(page).getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
 await expect(cell(page,0,0)).toHaveValue('Item 1');
});

test('nested column dialog traps focus and Escape preserves the sheet', async ({ page }) => {
 const add=sheet(page).getByRole('button',{name:'Добавить колонку',exact:true});
 await command(page,'Добавить колонку');
 const modal=page.getByRole('dialog',{name:'Настройка колонки',exact:true});
 await expect(modal).toBeVisible();
 await modal.getByLabel('Название',{exact:true}).fill('cancelled column');
 const create=modal.getByRole('button',{name:'Создать',exact:true});
 await create.focus(); await page.keyboard.press('Tab');
 await expect(modal.locator('button').first()).toBeFocused();
 await page.keyboard.press('Shift+Tab'); await expect(create).toBeFocused();
 await modal.getByLabel('Название',{exact:true}).focus();
 await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
 await expect(sheet(page)).toBeVisible(); await expect(sheet(page).locator('.sheet-command-menu>summary')).toBeFocused();
 await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-colcount','4');
 await page.keyboard.press('Escape'); await expect(sheet(page)).toHaveCount(0);
 await expect(page.getByTitle('Открыть таблицу',{exact:true}).first()).toBeFocused();
});

test('formula bar targets, suggestions, reference frames, regex search and font persistence',async({page},info)=>{
 await cell(page,0,3).click();
 const formula=sheet(page).getByRole('textbox',{name:'Формула или значение ячейки'});
 await formula.fill('=SU');await expect(sheet(page).getByRole('listbox',{name:'Подсказки формул'})).toContainText('SUM');
 await sheet(page).getByRole('option').filter({hasText:'SUM'}).first().click();await expect(formula).toHaveValue('=SUM(');
 await formula.fill('=SUM(B1:B3)');await expect(cell(page,0,1).locator('..')).toHaveCSS('box-shadow',/rgb\(99, 102, 241\)/);
 await formula.press('Enter');await expect(cell(page,0,3)).toHaveValue('60');await expect(cell(page,1,3)).toHaveValue('');
 await cell(page,1,3).click();await formula.fill('=D2');await formula.press('Enter');await expect(cell(page,1,3)).toHaveValue('#CYCLE!');
 await cell(page,2,0).click();await page.keyboard.type('Typing stays here');await page.keyboard.press('Enter');await expect(cell(page,2,0)).toHaveValue('Typing stays here');await expect(cell(page,0,0)).toHaveValue('Item 1');
 await cell(page,2,0).fill('Discard');await cell(page,2,0).press('Escape');await expect(cell(page,2,0)).toHaveValue('Typing stays here');await page.keyboard.type('After escape');await page.keyboard.press('Enter');await expect(cell(page,2,0)).toHaveValue('After escape');
 await page.keyboard.press('Control+f');const find=sheet(page).getByRole('search',{name:'Поиск в таблице'});await find.getByRole('textbox',{name:'Найти в таблице'}).fill('^Item (1|2)$');await find.getByRole('checkbox',{name:'Регулярное выражение'}).check();
 await expect(find.getByRole('status')).toHaveText('1 / 2');await expect(sheet(page).getByRole('grid')).toHaveAttribute('aria-rowcount','20');
 await find.getByRole('textbox').fill('[');await expect(find.getByRole('status')).toHaveText('Некорректное регулярное выражение');
 await find.getByRole('button',{name:'Закрыть поиск в таблице'}).click();
 await cell(page,0,0).click();await sheet(page).getByLabel('Шрифт',{exact:true}).selectOption('Georgia, serif');await sheet(page).getByLabel('Размер текста',{exact:true}).fill('20');await sheet(page).getByRole('button',{name:'Подчёркнутый',exact:true}).click();
 await expect(cell(page,0,0)).toHaveCSS('font-family','Georgia, serif');await expect(cell(page,0,0)).toHaveCSS('font-size','20px');await expect(cell(page,0,0)).toHaveCSS('text-decoration-line','underline');
 await expect.poll(async()=>String((await pool.query("SELECT format->>'fontFamily' AS font FROM dataset_cell_formats WHERE dataset_id=$1 AND row_id=$2 AND column_id=$3",[datasetId,rows[0].id,columns[0].id])).rows[0]?.font)).toBe('Georgia, serif');
 await page.screenshot({path:info.outputPath('sheet-controls.png')});
 await sheet(page).getByTitle('Закрыть (Esc)').click();await page.getByTitle('Открыть таблицу',{exact:true}).first().click();await expect(cell(page,0,0)).toHaveCSS('font-size','20px');
});

test('range paste cancel and cut keep data atomic; horizontal handle fills relative formulas',async({page})=>{
 page.removeAllListeners('dialog');
 let confirmations=0;page.on('dialog',dialog=>{confirmations++;expect(dialog.message()).toContain('Заменить');void dialog.dismiss();});
 await cell(page,0,0).click();await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Control+c');
 await cell(page,3,0).click();await page.keyboard.press('Control+v');await expect.poll(()=>confirmations).toBe(1);await expect(cell(page,3,0)).toHaveValue('Item 4');await expect(cell(page,4,0)).toHaveValue('Item 5');
 page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());
 await page.keyboard.press('Control+v');await expect(cell(page,3,0)).toHaveValue('Item 1');await expect(cell(page,4,0)).toHaveValue('Item 2');
 await cell(page,3,0).click();await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Control+x');await cell(page,6,0).click();await page.keyboard.press('Control+v');await expect(cell(page,3,0)).toHaveValue('');await expect(cell(page,4,0)).toHaveValue('');await expect(cell(page,6,0)).toHaveValue('Item 1');await expect(cell(page,7,0)).toHaveValue('Item 2');
 await page.keyboard.press('Control+z');await expect(cell(page,3,0)).toHaveValue('Item 1');await expect(cell(page,6,0)).toHaveValue('Item 7');
 await cell(page,0,1).fill('=B2');await cell(page,0,1).press('Enter');await cell(page,0,1).click();const handle=sheet(page).locator('.dataset-sheet__fill-handle');const from=await handle.boundingBox(),to=await cell(page,0,2).boundingBox();await page.mouse.move(from!.x+3,from!.y+3);await page.mouse.down();await page.mouse.move(to!.x+15,to!.y+15,{steps:6});await page.mouse.up();await expect(cell(page,0,2)).toHaveValue('3');
});

test('shared cell draft, Russian formulas, layout independent find and direct export menu',async({page},info)=>{
 const formula=sheet(page).getByRole('textbox',{name:'Формула или значение ячейки'});
 await cell(page,0,0).click();await formula.fill('Живой черновик');await expect(cell(page,0,0)).toHaveValue('Живой черновик');
 await cell(page,1,0).click();await expect(cell(page,0,0)).toHaveValue('Живой черновик');
 await cell(page,1,0).fill('Из ячейки');await expect(formula).toHaveValue('Из ячейки');
 await formula.click();await expect(cell(page,1,0)).toHaveValue('Из ячейки');await formula.fill('Отмена');await formula.press('Escape');
 await expect(cell(page,1,0)).toHaveValue('Item 2');await expect(formula).toHaveValue('Item 2');
 await cell(page,0,3).click();await formula.fill('=СУ');
 const suggestions=sheet(page).getByRole('listbox',{name:'Подсказки формул'});
 await expect(suggestions).toContainText('СУММ');
 const boxes=await suggestions.getByRole('option').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {y:b.y,bottom:b.bottom,height:b.height};}));
 for(let i=0;i<boxes.length;i++){expect(boxes[i].height).toBeGreaterThanOrEqual(24);expect(boxes[i].height).toBeLessThanOrEqual(28);if(i)expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i-1].bottom);}
 await expect(suggestions.getByRole('option').first()).toHaveAttribute('aria-selected','true');
 await formula.press('ArrowDown');await expect(suggestions.getByRole('option').nth(1)).toHaveAttribute('aria-selected','true');
 await expect(sheet(page).locator('.formula-suggestions__help')).toContainText('Сумма по условию');
 const listBox=await suggestions.boundingBox(),helpBox=await sheet(page).locator('.formula-suggestions__help').boundingBox();
 expect(listBox!.width).toBeLessThanOrEqual(230);expect(helpBox!.x).toBeGreaterThanOrEqual(listBox!.x+listBox!.width);
 await page.screenshot({path:info.outputPath('russian-formula-suggestions.png')});
 await formula.press('Enter');await expect(formula).toHaveValue('=СУММЕСЛИ(');await expect(formula).toBeFocused();
 await formula.fill('=СУ');await formula.press('ArrowDown');await formula.press('ArrowUp');await formula.press('Tab');await expect(formula).toHaveValue('=СУММ(');
 await cell(page,0,3).click();await cell(page,0,3).fill('=СУ');await cell(page,0,3).press('ArrowDown');await cell(page,0,3).press('Tab');await expect(formula).toHaveValue('=СУММЕСЛИ(');await expect(cell(page,0,3)).toBeFocused();

 await formula.fill('=ЕСЛИ(ИСТИНА;СУММ(B1:B3);0)');await expect(cell(page,0,3)).toHaveValue('=ЕСЛИ(ИСТИНА;СУММ(B1:B3);0)');
 await cell(page,1,3).click();await expect(cell(page,0,3)).toHaveValue('60');
 await cell(page,1,3).fill('=СУММЕСЛИ(B1:B3;">10")');await expect(formula).toHaveValue('=СУММЕСЛИ(B1:B3;">10")');await cell(page,1,3).press('Enter');await expect(cell(page,1,3)).toHaveValue('50');
 await cell(page,2,0).dispatchEvent('keydown',{key:'а',code:'KeyF',ctrlKey:true});
 await expect(sheet(page).getByRole('search',{name:'Поиск в таблице'})).toBeVisible();await sheet(page).getByRole('button',{name:'Закрыть поиск в таблице'}).click();
 const exportButton=sheet(page).getByRole('button',{name:'Экспорт таблицы',exact:true});await expect(exportButton).toHaveCSS('background-color','rgb(255, 255, 255)');
 await exportButton.click();await expect(sheet(page).getByRole('menuitem')).toHaveCount(3);await expect(sheet(page).getByRole('menuitem').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(exportButton).toBeFocused();await expect(sheet(page)).toBeVisible();
 await exportButton.click();const download=page.waitForEvent('download');await sheet(page).getByRole('menuitem',{name:'Excel (.xlsx)',exact:true}).click();
 const path=info.outputPath('russian-formulas.xlsx');await (await download).saveAs(path);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load((await readFile(path)) as any);
 expect(workbook.worksheets[0].getCell('D2').formula).toBe('IF(TRUE,SUM(B2:B4),0)');
 expect(workbook.worksheets[0].getCell('D3').formula).toBe('SUMIF(B2:B4,">10")');
 await expect(exportButton).toBeFocused();
 await sheet(page).getByTitle('Закрыть (Esc)').click();await page.getByTitle('Открыть таблицу',{exact:true}).first().click();
 await expect(cell(page,0,3)).toHaveValue('60');await expect(cell(page,1,3)).toHaveValue('50');await expect(cell(page,0,0)).toHaveValue('Живой черновик');
 await expect.poll(async()=>String((await pool.query('SELECT values FROM dataset_rows WHERE id=$1',[rows[0].id])).rows[0]?.values?.[columns[0].id])).toBe('Живой черновик');
});
