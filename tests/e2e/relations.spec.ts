import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const workspace = '20000000-0000-0000-0000-000000000001',
  base = 'http://localhost:3001/api';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://modelboard:modelboard@localhost:5432/modelboard',
});
let boardId: string, token: string, viewerToken: string, servers: any, vms: any;
const boards: string[] = [];
const inspector = (page: Page) => page.locator('.inspector-panel');
async function login(page: Page, board = boardId, role = 'OWNER') {
  await page.addInitScript(
    (id) => localStorage.setItem('modelboard:last-board', id),
    board,
  );
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: role }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
}
async function addServer(page: Page) {
  await page.getByTitle('Инфраструктура', { exact: true }).click();
  await page.getByRole('button', { name: 'Сервер', exact: true }).click();
  await expect(inspector(page)).toBeVisible();
}
async function bindServer(page: Page) {
  await inspector(page)
    .getByLabel('Dataset привязки', { exact: true })
    .selectOption(servers.id);
  await inspector(page)
    .getByLabel('Строка привязки')
    .selectOption(servers.rows[0].id);
  await inspector(page)
    .getByLabel(/Поле заголовка/)
    .selectOption(servers.columns[1].id);
  await inspector(page)
    .getByLabel('Поле подзаголовка', { exact: true })
    .selectOption(servers.columns[2].id);
  await inspector(page)
    .getByRole('checkbox', { name: 'status', exact: true })
    .check();
  await inspector(page)
    .getByLabel('Поле статуса', { exact: true })
    .selectOption(servers.columns[3].id);
  await inspector(page)
    .getByLabel('Цвета статусов', { exact: true })
    .fill('up=#22aa55; down=#cc3344');
  await inspector(page)
    .getByRole('button', { name: 'Привязать строку к объекту', exact: true })
    .click();
  await expect(page.locator('.bound-data')).toContainText('api-01');
}
test.beforeEach(async ({ request, page }) => {
  const users = await (await request.get(`${base}/auth/dev-users`)).json();
  const getToken = async (role: string) =>
    (
      await (
        await request.post(`${base}/auth/dev-login`, {
          data: { userId: users.find((user: any) => user.role === role).id },
        })
      ).json()
    ).token;
  token = await getToken('OWNER');
  viewerToken = await getToken('VIEWER');
  const headers = { Authorization: `Bearer ${token}` };
  boardId = (
    await (
      await request.post(`${base}/workspaces/${workspace}/boards`, {
        headers,
        data: { name: `Relations acceptance ${Date.now()}` },
      })
    ).json()
  ).id;
  boards.push(boardId);
  const create = async (name: string, defs: string[][], data: any[]) => {
    const columns = defs.map(([name, dataType], ordinal) => ({
      id: randomUUID(),
      name,
      dataType,
      ordinal,
    }));
    const rows = data.map((values, ordinal) => ({
      id: randomUUID(),
      ordinal,
      values: Object.fromEntries(
        values.map((value: any, index: number) => [columns[index].id, value]),
      ),
    }));
    const result = await request.post(
      `${base}/workspaces/${workspace}/datasets`,
      {
        headers,
        data: { name: `${name} ${randomUUID().slice(0, 8)}`, columns, rows },
      },
    );
    expect(result.ok()).toBeTruthy();
    return { ...(await result.json()), columns, rows };
  };
  const hostKey = randomUUID();
  servers = await create(
    'Servers',
    [
      ['id', 'UUID'],
      ['hostname', 'TEXT'],
      ['ip', 'TEXT'],
      ['status', 'TEXT'],
      ['cost', 'NUMBER'],
      ['unused', 'TEXT'],
    ],
    [[hostKey, 'api-01', '10.0.0.1', 'up', 100, 'unused']],
  );
  vms = await create(
    'VMs',
    [
      ['id', 'UUID'],
      ['host_id', 'UUID'],
      ['name', 'TEXT'],
    ],
    [
      [randomUUID(), hostKey, 'vm-01'],
      [randomUUID(), hostKey, 'vm-02'],
    ],
  );
  await login(page);
});
test.afterEach(async ({ page, request }) => {
  await page.goto('about:blank');
  for (const id of boards.splice(0))
    await request.delete(`${base}/boards/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  await pool.query('DELETE FROM datasets WHERE id=ANY($1::uuid[])', [
    [servers?.id, vms?.id].filter(Boolean),
  ]);
});
test.afterAll(async () => {
  await pool.end();
});
test('palette placement, configured row fields and source updates across boards', async ({
  page,
  browser,
  request,
}) => {
  await addServer(page);
  await bindServer(page);
  await expect(page.locator('.bound-data__status')).toHaveCSS(
    'color',
    'rgb(34, 170, 85)',
  );
  const secondBoard = (
    await (
      await request.post(`${base}/workspaces/${workspace}/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Second live view' },
      })
    ).json()
  ).id;
  boards.push(secondBoard);
  const other = await browser.newPage();
  try {
    await login(other, secondBoard, 'EDITOR');
    await addServer(other);
    await bindServer(other);
    await page.getByTitle('Перейти к источнику данных').click();
    const sheet = page.locator('.dataset-sheet');
    const ip = sheet.locator(
      `td[data-row-id="${servers.rows[0].id}"][data-column-id="${servers.columns[2].id}"] textarea`,
    );
    await ip.fill('10.0.0.42');
    await ip.press('Tab');
    await expect(other.locator('.bound-data')).toContainText('10.0.0.42');
    await sheet.getByTitle('Закрыть (Esc)').click();
    await expect(page.locator('.bound-data')).toContainText('10.0.0.42');
    await addServer(page);
    await expect(page.locator('.react-flow__node-device')).toHaveCount(2);
    const boxes = await page
      .locator('.react-flow__node-device')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    expect(
      boxes[0].x + boxes[0].w <= boxes[1].x ||
        boxes[1].x + boxes[1].w <= boxes[0].x ||
        boxes[0].y + boxes[0].h <= boxes[1].y ||
        boxes[1].y + boxes[1].h <= boxes[0].y,
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath('configured-bindings.png'),
    });
  } finally {
    await other.close();
  }
});
test('delete unused column through UI and protect actual presentation fields with clear conflicts', async ({
  page,
  request,
}) => {
  await addServer(page);
  await bindServer(page);
  const denied = await request.delete(
    `${base}/datasets/${servers.id}/columns/${servers.columns[2].id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(denied.status()).toBe(409);
  await page.getByTitle('Перейти к источнику данных').click();
  const sheet = page.locator('.dataset-sheet');
  await sheet.getByTitle('Удалить колонку', { exact: true }).last().click();
  await sheet
    .locator('.dataset-sheet__column-dialog')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await expect(sheet.getByRole('grid')).toHaveAttribute('aria-colcount', '5');
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM dataset_columns WHERE dataset_id=$1',
            [servers.id],
          )
        ).rows[0].count,
      ),
    )
    .toBe(5);
  await sheet.getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
  await expect(sheet.getByRole('grid')).toHaveAttribute('aria-colcount', '6');
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM dataset_columns WHERE dataset_id=$1',
            [servers.id],
          )
        ).rows[0].count,
      ),
    )
    .toBe(6);
});
test('relation manager creates FK, validates, draws ER, edits labels and deletes globally', async ({
  page,
  request,
}) => {
  await page.getByTitle('Данные', { exact: true }).click();
  await page.getByRole('button', { name: 'Связи', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Управление связями' });
  await manager.getByLabel('Название связи', { exact: true }).fill('VM owner');
  await manager.getByLabel('Исходный Dataset').selectOption(vms.id);
  await manager.getByLabel('Исходное поле').selectOption(vms.columns[1].id);
  await manager.getByLabel('Целевой Dataset').selectOption(servers.id);
  await manager.getByLabel('Целевое поле').selectOption(servers.columns[0].id);
  await manager
    .getByLabel('Тип связи', { exact: true })
    .selectOption('FOREIGN_KEY');
  await manager
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  const card = manager
    .locator('.relation-card')
    .filter({ hasText: 'VM owner' });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(card).toContainText('2 совпадений');
  await card.getByRole('button', { name: 'Показать ER', exact: true }).click();
  await expect(page.locator('.react-flow__node-table')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const relations = await (
    await request.get(`${base}/workspaces/${workspace}/relations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const relation = relations.find((r: any) => r.name === 'VM owner');
  expect(relation).toBeTruthy();
  const blocked = await request.delete(
    `${base}/datasets/${servers.id}/rows/${servers.rows[0].id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(blocked.status()).toBe(409);
  const update = await request.put(
    `${base}/workspaces/${workspace}/relations/${relation.id}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...relation, name: 'Runs on' },
    },
  );
  expect(update.ok()).toBeTruthy();
  await expect(page.locator('.react-flow__edge')).toContainText('Runs on');
  const forbidden = await request.delete(
    `${base}/workspaces/${workspace}/relations/${relation.id}`,
    { headers: { Authorization: `Bearer ${viewerToken}` } },
  );
  expect(forbidden.status()).toBe(403);
  await page.getByTitle('Данные', { exact: true }).click();
  await page.getByRole('button', { name: 'Связи', exact: true }).click();
  const updated = manager
    .locator('.relation-card')
    .filter({ hasText: 'Runs on' });
  await updated
    .getByRole('button', { name: 'Удалить связь', exact: true })
    .click();
  await updated
    .getByRole('button', { name: 'Подтвердить удаление связи', exact: true })
    .click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(updated).toHaveCount(0);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(2);
});
test('Dataset deletion removes live views, detaches objects and survives board Undo and reload', async ({
  page,
  request,
  browser,
}) => {
  await addServer(page);
  await bindServer(page);
  const deviceId = await page
    .locator('.react-flow__node-device')
    .getAttribute('data-id');
  const dormantBoard = (
    await (
      await request.post(`${base}/workspaces/${workspace}/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Dormant dataset view' },
      })
    ).json()
  ).id;
  boards.push(dormantBoard);
  const dormant = await browser.newPage();
  await login(dormant, dormantBoard, 'EDITOR');
  await dormant.getByTitle('Данные', { exact: true }).click();
  await dormant
    .locator('.dataset-card')
    .filter({ hasText: servers.name })
    .getByRole('button', { name: 'Place', exact: true })
    .click();
  await dormant.close();
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM collab_documents WHERE document_name=$1',
            [`board:${dormantBoard}`],
          )
        ).rows[0].count,
      ),
    )
    .toBe(1);

  await page.getByTitle('Данные', { exact: true }).click();
  const card = page.locator('.dataset-card').filter({ hasText: servers.name });
  await card.getByRole('button', { name: 'Place', exact: true }).click();
  await expect(page.locator('.react-flow__node-table')).toHaveCount(1);
  await card.getByTitle('Удалить Dataset', { exact: true }).click();
  await expect(
    page.getByRole('alertdialog', { name: 'Удалить Dataset' }),
  ).toContainText(servers.name);
  await page
    .getByRole('button', {
      name: 'Удалить Dataset и представления',
      exact: true,
    })
    .click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(0);
  await expect(page.locator('.react-flow__node-device')).toHaveCount(1);
  await expect(page.locator('.device-node .bound-data')).toHaveCount(0);
  await page.locator('.datasets-panel header button').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node-table')).toHaveCount(0);
  expect(
    (
      await request.get(`${base}/datasets/${servers.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(403);
  const reader = await browser.newPage();
  try {
    await login(reader, dormantBoard, 'VIEWER');
    await expect(reader.locator('.react-flow__node-table')).toHaveCount(0);
  } finally {
    await reader.close();
  }

  await page.reload();
  await page.getByRole('button').filter({ hasText: 'OWNER' }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
  await expect(
    page.locator(`.react-flow__node[data-id="${deviceId}"] .bound-data`),
  ).toHaveCount(0);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(0);
});
test('Cell, Column and Dataset bindings render their selected source and validate foreign fields', async ({
  page,
  request,
}) => {
  await addServer(page);
  await bindServer(page);
  await inspector(page)
    .getByLabel('Тип привязки', { exact: true })
    .selectOption('CELL');
  await inspector(page)
    .getByLabel('Поле привязки', { exact: true })
    .selectOption(servers.columns[2].id);
  await inspector(page)
    .getByRole('button', { name: 'Обновить привязку', exact: true })
    .click();
  await expect(
    page.locator('.bound-data[data-binding-type="CELL"]'),
  ).toContainText('10.0.0.1');
  await inspector(page)
    .getByLabel('Тип привязки', { exact: true })
    .selectOption('COLUMN');
  await inspector(page)
    .getByLabel('Поле привязки', { exact: true })
    .selectOption(servers.columns[4].id);
  await inspector(page)
    .getByLabel('Агрегат', { exact: true })
    .selectOption('SUM');
  await inspector(page)
    .getByRole('button', { name: 'Обновить привязку', exact: true })
    .click();
  await expect(
    page.locator('.bound-data[data-binding-type="COLUMN"]'),
  ).toContainText('SUM: 100');
  await inspector(page)
    .getByLabel('Тип привязки', { exact: true })
    .selectOption('DATASET');
  await inspector(page)
    .getByRole('button', { name: 'Обновить привязку', exact: true })
    .click();
  await expect(
    page.locator('.bound-data[data-binding-type="DATASET"]'),
  ).toContainText('1 строк');
  const objectId = await page
    .locator('.react-flow__node-device')
    .getAttribute('data-id');
  const invalid = await request.put(
    `${base}/boards/${boardId}/objects/${objectId}/binding`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        type: 'ROW',
        datasetId: servers.id,
        rowId: servers.rows[0].id,
        presentation: { fieldColumnIds: [vms.columns[2].id] },
      },
    },
  );
  expect(invalid.status()).toBe(400);
  const forbidden = await request.delete(`${base}/datasets/${servers.id}`, {
    headers: { Authorization: `Bearer ${viewerToken}` },
  });
  expect(forbidden.status()).toBe(403);
});
test('FK rejects API orphan inserts and realtime orphan edits, then recovers after Undo', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(
    `${base}/workspaces/${workspace}/relations`,
    {
      headers,
      data: {
        sourceDatasetId: vms.id,
        sourceColumnId: vms.columns[1].id,
        targetDatasetId: servers.id,
        targetColumnId: servers.columns[0].id,
        relationType: 'FOREIGN_KEY',
        cardinality: 'N:1',
        name: 'Host integrity',
      },
    },
  );
  expect(created.ok()).toBeTruthy();
  const orphan = await request.post(`${base}/datasets/${vms.id}/rows/batch`, {
    headers,
    data: {
      rows: [
        {
          id: randomUUID(),
          values: {
            [vms.columns[0].id]: randomUUID(),
            [vms.columns[1].id]: randomUUID(),
          },
        },
      ],
    },
  });
  expect(orphan.status()).toBe(409);
  expect(
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',
          [vms.id],
        )
      ).rows[0].count,
    ),
  ).toBe(2);
  await page.getByTitle('Данные', { exact: true }).click();
  await page
    .locator('.dataset-card')
    .filter({ hasText: vms.name })
    .getByRole('button', { name: 'Place', exact: true })
    .click();
  await page.locator('.datasets-panel header button').click();
  await page.getByTitle('Открыть таблицу', { exact: true }).click();
  const sheet = page.locator('.dataset-sheet');
  const key = sheet.locator(
    `td[data-row-id="${vms.rows[0].id}"][data-column-id="${vms.columns[1].id}"] textarea`,
  );
  await key.fill(randomUUID());
  await key.press('Tab');
  await expect(sheet.getByRole('alert')).toContainText('Нет соответствия');
  expect(
    (
      await pool.query('SELECT values FROM dataset_rows WHERE id=$1', [
        vms.rows[0].id,
      ])
    ).rows[0].values[vms.columns[1].id],
  ).toBe(servers.rows[0].values[servers.columns[0].id]);
  await sheet.getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
  await expect(key).toHaveValue(servers.rows[0].values[servers.columns[0].id]);
  await expect(sheet.getByRole('alert')).toHaveCount(0);
});
test('creating a bound infrastructure object from a row prefers hostname and stays visible above the table', async ({
  page,
}) => {
  await page.getByTitle('Данные', { exact: true }).click();
  await page
    .locator('.dataset-card')
    .filter({ hasText: servers.name })
    .getByRole('button', { name: 'Place', exact: true })
    .click();
  await page.locator('.datasets-panel header button').click();
  await page.getByTitle('Открыть таблицу', { exact: true }).click();
  await page
    .locator('.dataset-sheet')
    .getByTitle('Создать привязанный объект на canvas', { exact: true })
    .first()
    .click();
  await expect(page.locator('.dataset-sheet')).toHaveCount(0);
  await expect(page.locator('.device-node .bound-data')).toContainText(
    'api-01',
  );
  await expect(page.locator('.device-node .bound-data')).toContainText(
    '10.0.0.1',
  );
  await expect(page.locator('.react-flow__node-device')).toBeInViewport();
});
test('undoing Unbind restores the SQL binding and protects its presentation columns', async ({
  page,
  request,
}) => {
  await addServer(page);
  await bindServer(page);
  const objectId = await page
    .locator('.react-flow__node-device')
    .getAttribute('data-id');
  await inspector(page)
    .getByRole('button', { name: 'Отвязать', exact: true })
    .click();
  await expect(page.locator('.bound-data')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.bound-data')).toContainText('api-01');
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            'SELECT row_id FROM object_bindings WHERE board_id=$1 AND board_object_id=$2',
            [boardId, objectId],
          )
        ).rows[0]?.row_id,
    )
    .toBe(servers.rows[0].id);
  const denied = await request.delete(
    `${base}/datasets/${servers.id}/columns/${servers.columns[3].id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(denied.status()).toBe(409);
});
test('Workspace SVG templates reuse configured live bindings when duplicated', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` },
    name = `Server template ${randomUUID().slice(0, 8)}`;
  const response = await request.post(
    `${base}/workspaces/${workspace}/templates`,
    {
      headers,
      data: {
        name,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="#eef0ff"/></svg>',
        defaultWidth: 220,
        defaultHeight: 130,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const template = await response.json();
  try {
    await page.reload();
    await page.getByRole('button').filter({ hasText: 'OWNER' }).click();
    await page.getByTitle('Инфраструктура', { exact: true }).click();
    await page.getByTitle(name, { exact: true }).click();
    await bindServer(page);
    await expect(page.locator('.template-node .bound-data')).toContainText(
      'api-01',
    );
    await page
      .locator('.react-flow__node-template .template-node__visual')
      .click();
    await page.keyboard.press('Control+d');
    await expect(page.locator('.react-flow__node-template')).toHaveCount(2);
    await expect(page.locator('.template-node .bound-data')).toHaveCount(2);
    expect(
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM dataset_rows WHERE dataset_id=$1',
            [servers.id],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  } finally {
    await request.delete(
      `${base}/workspaces/${workspace}/templates/${template.id}`,
      { headers },
    );
  }
});

test('Relation View navigates to matching rows and recalculates membership after edits', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.post(
    `${base}/workspaces/${workspace}/relations`,
    {
      headers,
      data: {
        sourceDatasetId: vms.id,
        sourceColumnId: vms.columns[1].id,
        targetDatasetId: servers.id,
        targetColumnId: servers.columns[0].id,
        relationType: 'FOREIGN_KEY',
        cardinality: 'N:1',
        name: 'Live related VMs',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const relation = await response.json();
  await addServer(page);
  await bindServer(page);
  await inspector(page)
    .getByRole('button', { name: 'Добавить Relation View', exact: true })
    .click();
  const view = page.locator('.relation-view-node');
  await expect(view.locator('.relation-view-node__row')).toHaveCount(2);
  await inspector(page).locator('header button').click();
  await page.keyboard.press('Control+0');
  await view
    .locator('.relation-view-node__row')
    .filter({ hasText: 'vm-01' })
    .click();
  const sheet = page.locator('.dataset-sheet'),
    name = sheet.locator(
      `td[data-row-id="${vms.rows[0].id}"][data-column-id="${vms.columns[2].id}"] textarea`,
    ),
    key = sheet.locator(
      `td[data-row-id="${vms.rows[0].id}"][data-column-id="${vms.columns[1].id}"] textarea`,
    );
  await name.fill('vm-updated');
  await name.press('Tab');
  await key.fill('');
  await key.press('Tab');
  await expect(view.locator('.relation-view-node__row')).toHaveCount(1);
  await sheet.getByTitle('Отменить изменение Dataset (Ctrl+Z)').click();
  await expect(view.locator('.relation-view-node__row')).toHaveCount(2);
  await sheet.getByTitle('Закрыть (Esc)').click();
  await expect(view).toContainText('vm-updated');
  expect(
    (
      await request.delete(
        `${base}/workspaces/${workspace}/relations/${relation.id}`,
        { headers },
      )
    ).ok(),
  ).toBeTruthy();
  await expect(page.locator('.react-flow__node-relationView')).toHaveCount(0);
  await expect(page.locator('.react-flow__node-device')).toHaveCount(1);
});

test('table relationships link records without keys, append atomically, navigate and protect cardinality', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  await page.getByTitle('Данные', { exact: true }).click();
  await page
    .locator('.dataset-card')
    .filter({ hasText: servers.name })
    .getByRole('button', { name: 'Place', exact: true })
    .click();
  await page.locator('.datasets-panel header button').click();
  const table = page.locator('.react-flow__node-table');
  await table
    .getByRole('button', { name: 'Связи таблицы', exact: true })
    .click();
  const panel = page.getByRole('dialog', {
    name: 'Связи таблицы',
    exact: true,
  });
  await panel.getByLabel('Связать с таблицей').selectOption(vms.id);
  await panel.getByRole('button', { name: 'Настроить новую связь' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Создать связь данных',
    exact: true,
  });
  await dialog
    .getByLabel('Запись слева', { exact: true })
    .selectOption(servers.rows[0].id);
  await dialog
    .getByLabel('Запись справа', { exact: true })
    .selectOption(vms.rows[0].id);
  await dialog
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await panel
    .getByLabel(`Запись в ${servers.name}`, { exact: true })
    .selectOption(servers.rows[0].id);
  await expect(panel).toContainText('Связанных записей: 1');
  await panel
    .getByLabel('Добавить связанную запись', { exact: true })
    .selectOption(vms.rows[1].id);
  await panel
    .getByRole('button', { name: 'Связать записи', exact: true })
    .click();
  await expect(panel).toContainText('Связанных записей: 2');
  const relation = (
    await (
      await request.get(`${base}/workspaces/${workspace}/relations`, {
        headers,
      })
    ).json()
  ).find(
    (r: any) => r.sourceDatasetId === servers.id && r.matchMode === 'ROW_LINKS',
  );
  expect(relation.links).toHaveLength(2);
  const invalid = await request.put(
    `${base}/workspaces/${workspace}/relations/${relation.id}`,
    { headers, data: { ...relation, cardinality: '1:1' } },
  );
  expect(invalid.status()).toBe(409);
  expect(
    (
      await request.post(
        `${base}/workspaces/${workspace}/relations/${relation.id}/links`,
        {
          headers: { Authorization: `Bearer ${viewerToken}` },
          data: {
            sourceRowId: servers.rows[0].id,
            targetRowId: vms.rows[0].id,
          },
        },
      )
    ).status(),
  ).toBe(403);
  // Business key columns can be deleted without destroying direct record links.
  for (const [id, col] of [
    [servers.id, servers.columns[0].id],
    [vms.id, vms.columns[1].id],
  ])
    expect(
      (
        await request.delete(`${base}/datasets/${id}/columns/${col}`, {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
  const validation = await (
    await request.get(
      `${base}/workspaces/${workspace}/relations/${relation.id}/validation`,
      { headers },
    )
  ).json();
  expect(validation.valid).toBe(true);
  expect(validation.matchedRows).toBe(2);
  await panel.getByRole('button', { name: /vm-02.*↗/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.dataset-sheet')).toContainText(vms.name);
});

test('rename dataset synchronizes views and deleted columns restore original identity and values after reopen', async ({
  page,
  request,
}) => {
  await page.getByTitle('Данные', { exact: true }).click();
  const card = page.locator('.dataset-card').filter({ hasText: servers.name });
  await card.getByRole('button', { name: 'Place', exact: true }).click();
  await page.locator('.datasets-panel header button').click();
  const table = page.locator('.react-flow__node-table');
  await table.getByRole('button', { name: 'Открыть', exact: true }).click();
  const sheet = page.locator('.dataset-sheet');
  await sheet.getByTitle('Редактировать имя Dataset').click();
  await sheet
    .getByLabel('Имя Dataset', { exact: true })
    .fill('Переименованные серверы');
  await sheet
    .getByRole('button', { name: 'Сохранить имя', exact: true })
    .click();
  await expect(table).toContainText('Переименованные серверы');
  expect(
    (
      await request.put(`${base}/datasets/${servers.id}`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
        data: { name: 'forbidden' },
      })
    ).status(),
  ).toBe(403);
  await sheet.getByTitle('Удалить колонку', { exact: true }).last().click();
  await sheet
    .locator('.dataset-sheet__column-dialog')
    .getByRole('button', { name: 'Удалить', exact: true })
    .click();
  await expect(sheet.getByRole('grid')).toHaveAttribute('aria-colcount', '5');
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM dataset_columns WHERE dataset_id=$1',
            [servers.id],
          )
        ).rows[0].count,
      ),
    )
    .toBe(5);
  await sheet.getByTitle('Закрыть (Esc)').click();
  await page.reload();
  await page.getByRole('button').filter({ hasText: 'OWNER' }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
  await expect(table).toContainText('Переименованные серверы');
  await table.getByRole('button', { name: 'Открыть', exact: true }).click();
  await sheet.locator('.sheet-deleted-columns summary').click();
  await sheet
    .getByRole('button', { name: 'Восстановить «unused»', exact: true })
    .click();
  await expect(sheet.getByRole('grid')).toHaveAttribute('aria-colcount', '6');
  await expect(
    sheet.locator(
      `td[data-row-id="${servers.rows[0].id}"][data-column-id="${servers.columns[5].id}"] textarea`,
    ),
  ).toHaveValue('unused');
  await expect
    .poll(async () =>
      Number(
        (
          await pool.query('SELECT count(*) FROM dataset_columns WHERE id=$1', [
            servers.columns[5].id,
          ])
        ).rows[0].count,
      ),
    )
    .toBe(1);
  await sheet.getByTitle('Закрыть (Esc)').click();
  await table.locator('.table-node__title strong').click();
  await expect(page.locator('.selection-actions')).toHaveCount(0);
  await expect(
    page.locator('.inspector-panel .canvas-properties'),
  ).toBeVisible();
});

test('connector between bound objects prefills records and can extend the same relation', async ({
  page,
  request,
}) => {
  await addServer(page);
  await bindServer(page);
  await addServer(page);
  await inspector(page)
    .getByLabel('Dataset привязки', { exact: true })
    .selectOption(vms.id);
  await inspector(page)
    .getByLabel('Строка привязки')
    .selectOption(vms.rows[0].id);
  await inspector(page)
    .getByLabel(/Поле заголовка/)
    .selectOption(vms.columns[2].id);
  await inspector(page)
    .getByRole('button', { name: 'Привязать строку к объекту', exact: true })
    .click();
  const devices = page.locator('.react-flow__node-device');
  await page.getByTitle('Коннектор (C)', { exact: true }).click();
  await devices.nth(0).locator('.device-node__glyph').click();
  await devices.nth(1).locator('.device-node__glyph').click();
  const dialog = page.getByRole('dialog', {
    name: 'Создать связь данных',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Запись слева', { exact: true })).toHaveValue(
    servers.rows[0].id,
  );
  await expect(dialog.getByLabel('Запись справа', { exact: true })).toHaveValue(
    vms.rows[0].id,
  );
  await dialog
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByTitle('Выбор (V)', { exact: true }).click();
  await devices.nth(1).locator('.device-node__glyph').click();
  await inspector(page)
    .getByLabel('Строка привязки')
    .selectOption(vms.rows[1].id);
  await inspector(page)
    .getByRole('button', { name: 'Обновить привязку', exact: true })
    .click();
  await page.getByTitle('Коннектор (C)', { exact: true }).click();
  await devices.nth(0).locator('.device-node__glyph').click();
  await devices.nth(1).locator('.device-node__glyph').click();
  const relations = (
    await (
      await request.get(`${base}/workspaces/${workspace}/relations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()
  ).filter(
    (r: any) =>
      r.sourceDatasetId === servers.id && r.targetDatasetId === vms.id,
  );
  expect(relations).toHaveLength(1);
  await dialog
    .getByLabel('Использовать связь', { exact: true })
    .selectOption(relations[0].id);
  await dialog
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const updated = (
    await (
      await request.get(`${base}/workspaces/${workspace}/relations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()
  ).filter(
    (r: any) =>
      r.sourceDatasetId === servers.id && r.targetDatasetId === vms.id,
  );
  expect(updated).toHaveLength(1);
  expect(updated[0].links).toHaveLength(2);
  await page.getByTitle('Выбор (V)', { exact: true }).click();
  await devices.nth(0).locator('.device-node__glyph').click();
  await expect(inspector(page).locator('.related-records')).toContainText(
    'vm-02',
  );
});

test('general table connector opens field mapping by names and supports parent to children FK', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const data = {
    sourceDatasetId: servers.id,
    sourceColumnId: servers.columns[0].id,
    targetDatasetId: vms.id,
    targetColumnId: vms.columns[1].id,
    relationType: 'FOREIGN_KEY',
    cardinality: '1:N',
    name: 'Сервер и VM',
  };
  expect(
    (
      await request.post(`${base}/workspaces/${workspace}/relations`, {
        headers,
        data,
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByTitle('Данные', { exact: true }).click();
  await page
    .locator('.datasets-panel')
    .getByRole('button', { name: 'Связи', exact: true })
    .click();
  await page
    .locator('.relation-card')
    .filter({ hasText: 'Сервер и VM' })
    .getByRole('button', { name: 'Показать ER', exact: true })
    .click();
  const tables = page.locator('.react-flow__node-table');
  await expect(tables).toHaveCount(2);
  await page.getByTitle('Коннектор (C)', { exact: true }).click();
  await tables
    .filter({ hasText: servers.name })
    .locator('.table-node__title strong')
    .click();
  await tables
    .filter({ hasText: vms.name })
    .locator('.table-node__title strong')
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Создать связь данных',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Способ связи', { exact: true })
    .selectOption('FIELDS');
  await dialog
    .getByLabel('Поле слева', { exact: true })
    .selectOption(servers.columns[0].id);
  await dialog
    .getByLabel('Поле справа', { exact: true })
    .selectOption(vms.columns[1].id);
  await expect(
    dialog.getByLabel('Поле слева', { exact: true }).locator('option:checked'),
  ).toHaveText('id (UUID)');
  await dialog
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const relations = (
    await (
      await request.get(`${base}/workspaces/${workspace}/relations`, {
        headers,
      })
    ).json()
  ).filter(
    (r: any) =>
      r.sourceDatasetId === servers.id && r.targetDatasetId === vms.id,
  );
  expect(relations).toHaveLength(2);
  expect(relations.every((r: any) => r.cardinality === '1:N')).toBeTruthy();
  await page.getByTitle('Коннектор (C)', { exact: true }).click();
  await tables
    .filter({ hasText: servers.name })
    .locator('.table-node__title strong')
    .click();
  await tables
    .filter({ hasText: vms.name })
    .locator('.table-node__title strong')
    .click();
  await dialog
    .getByLabel('Способ связи', { exact: true })
    .selectOption('FIELDS');
  await dialog
    .getByLabel('Поле слева', { exact: true })
    .selectOption(servers.columns[0].id);
  await dialog
    .getByLabel('Поле справа', { exact: true })
    .selectOption(vms.columns[1].id);
  await dialog
    .getByLabel('Кардинальность', { exact: true })
    .selectOption('N:M');
  await dialog
    .getByRole('button', { name: 'Создать связь', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const many = (
    await (
      await request.get(`${base}/workspaces/${workspace}/relations`, {
        headers,
      })
    ).json()
  ).find(
    (r: any) => r.sourceDatasetId === servers.id && r.cardinality === 'N:M',
  );
  expect(many.relationType).toBe('REFERENCE');
});

test('concurrent record links survive metadata edits and reject foreign rows and invalid dataset names', async ({
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const initial = {
    sourceDatasetId: servers.id,
    targetDatasetId: vms.id,
    sourceColumnId: '__row__',
    targetColumnId: '__row__',
    matchMode: 'ROW_LINKS',
    links: [],
    relationType: 'REFERENCE',
    cardinality: '1:N',
  };
  const response = await request.post(
    `${base}/workspaces/${workspace}/relations`,
    { headers, data: initial },
  );
  expect(response.ok()).toBeTruthy();
  const relation = await response.json();
  const responses = await Promise.all(
    vms.rows.map((row: any) =>
      request.post(
        `${base}/workspaces/${workspace}/relations/${relation.id}/links`,
        {
          headers,
          data: { sourceRowId: servers.rows[0].id, targetRowId: row.id },
        },
      ),
    ),
  );
  expect(responses.every((r) => r.ok())).toBeTruthy();
  const renamed = await request.put(
    `${base}/workspaces/${workspace}/relations/${relation.id}`,
    {
      headers,
      data: { ...relation, links: undefined, name: 'Параллельные связи' },
    },
  );
  expect(renamed.ok()).toBeTruthy();
  expect((await renamed.json()).links).toHaveLength(2);
  const foreign = await request.post(
    `${base}/workspaces/${workspace}/relations/${relation.id}/links`,
    {
      headers,
      data: {
        sourceRowId: servers.rows[0].id,
        targetRowId: servers.rows[0].id,
      },
    },
  );
  expect(foreign.status()).toBe(409);
  const invalidName = await request.put(`${base}/datasets/${servers.id}`, {
    headers,
    data: { name: '   ' },
  });
  expect(invalidName.status()).toBe(400);
});
