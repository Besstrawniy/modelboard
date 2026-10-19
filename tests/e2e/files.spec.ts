import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
const workspace = '20000000-0000-0000-0000-000000000001',
  base = 'http://localhost:3001/api';
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://modelboard:modelboard@localhost:5432/modelboard',
});
let boardId: string, token: string, viewerToken: string;
const boards: string[] = [],
  datasets: string[] = [],
  assets: string[] = [],
  templates: string[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=',
  'base64',
);
async function login(page: Page, id = boardId, role = 'OWNER') {
  await page.addInitScript(
    (id) => localStorage.setItem('modelboard:last-board', id),
    id,
  );
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: role }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
}
async function drop(
  page: Page,
  files: Array<{ name: string; buffer: Buffer; type: string }>,
) {
  await page.evaluate(
    (files) => {
      const data = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (c) =>
          c.charCodeAt(0),
        );
        data.items.add(new File([bytes], file.name, { type: file.type }));
      }
      document.querySelector('.board-shell')!.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: 400,
          clientY: 250,
        }),
      );
    },
    files.map((f) => ({
      name: f.name,
      base64: f.buffer.toString('base64'),
      type: f.type,
    })),
  );
}
async function confirm(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/workspaces/${workspace}/files/import`) &&
      r.request().method() === 'POST',
  );
  await page
    .getByRole('button', {
      name: 'Создать таблицы и добавить файлы',
      exact: true,
    })
    .click();
  const result = await (await response).json();
  for (const d of result.datasets ?? []) datasets.push(d.id);
  for (const f of result.files ?? []) assets.push(f.id);
  return result;
}
test.beforeEach(async ({ page, request }) => {
  const users = await (await request.get(`${base}/auth/dev-users`)).json();
  const auth = async (role: string) =>
    (
      await (
        await request.post(`${base}/auth/dev-login`, {
          data: { userId: users.find((u: any) => u.role === role).id },
        })
      ).json()
    ).token;
  token = await auth('OWNER');
  viewerToken = await auth('VIEWER');
  boardId = (
    await (
      await request.post(`${base}/workspaces/${workspace}/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `Files acceptance ${Date.now()}` },
      })
    ).json()
  ).id;
  boards.push(boardId);
  await login(page);
});
test.afterEach(async ({ page, request }) => {
  await page.goto('about:blank');
  for (const id of boards.splice(0))
    await request.delete(`${base}/boards/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  if (datasets.length)
    await pool.query('DELETE FROM datasets WHERE id=ANY($1::uuid[])', [
      datasets.splice(0),
    ]);
  if (assets.length)
    await pool.query('DELETE FROM workspace_files WHERE id=ANY($1::uuid[])', [
      assets.splice(0),
    ]);
  if (templates.length)
    await pool.query('DELETE FROM object_templates WHERE id=ANY($1::uuid[])', [
      templates.splice(0),
    ]);
});
test.afterAll(async () => {
  await pool.end();
});
test('drop CSV, TSV and multi-sheet XLSX into tables and export formulas and styles', async ({
  page,
}, info) => {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('Servers');
  ws.addRow(['name', 'qty', 'price', 'total']);
  // Generated books often have no Excel cache; supported formulas must calculate.
  ws.addRow(['api-01', 2, 12.5, { formula: 'B2*C2' }]);
  ws.getCell('D2').font = { bold: true };
  ws.getCell('D2').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFF0000' },
  };
  wb.addWorksheet('Codes').addRows([
    ['code', 'active'],
    ['001', true],
  ]);
  await drop(page, [
    {
      name: 'book.xlsx',
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      name: 'hosts.csv',
      buffer: Buffer.from('hostname,ip\nvm-1,10.0.0.1\n'),
      type: 'text/csv',
    },
    {
      name: 'notes.tsv',
      buffer: Buffer.from('name\tnote\nnode\t"hello\tworld"\n'),
      type: 'text/tab-separated-values',
    },
  ]);
  const dialog = page.getByRole('dialog', {
    name: 'Импорт файлов',
    exact: true,
  });
  await expect(dialog).toContainText('Servers');
  await expect(dialog).toContainText('Codes');
  await expect(dialog.locator('.file-sheet-preview')).toHaveCount(4);
  await expect(
    dialog.locator('.file-sheet-preview').filter({ hasText: 'Servers' }),
  ).toContainText('25');
  const imported = await confirm(page);
  expect(imported.datasets).toHaveLength(4);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(4);
  const server = imported.datasets.find((d: any) => d.name === 'Servers');
  await page
    .locator('.react-flow__node-table')
    .filter({ hasText: 'Servers' })
    .getByRole('button', { name: 'Открыть таблицу', exact: true })
    .click();
  const sheet = page.locator('.dataset-sheet');
  await expect(sheet.locator('tbody textarea').last()).toHaveValue('25');
  const download = page.waitForEvent('download');
  await sheet
    .getByRole('button', { name: 'Экспорт таблицы', exact: true })
    .click();
  const file = await download,
    path = info.outputPath('export.xlsx');
  await file.saveAs(path);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load((await readFile(path)) as any);
  expect(exported.worksheets[0].getCell('D2').formula).toBe('B2*C2');
  expect(exported.worksheets[0].getCell('D2').result).toBe(25);
  expect(exported.worksheets[0].getCell('D2').font.bold).toBe(true);
  const codes = imported.datasets.find((d: any) => d.name === 'Codes');
  expect(
    Object.values(
      (
        await pool.query(
          'SELECT values FROM dataset_rows WHERE dataset_id=$1',
          [codes.id],
        )
      ).rows[0].values,
    ),
  ).toContain('001');
});
test('images persist and a portable board archive restores bindings, datasets and assets', async ({
  page,
  request,
  browser,
}, info) => {
  await drop(page, [
    { name: 'tiny.png', buffer: png, type: 'image/png' },
    {
      name: 'names.csv',
      buffer: Buffer.from('name,qty\napi-01,2\n'),
      type: 'text/csv',
    },
  ]);
  const imported = await confirm(page);
  await expect(page.locator('.image-node img')).toBeVisible();
  await page
    .locator('.react-flow__node-table')
    .getByRole('button', { name: 'Открыть таблицу', exact: true })
    .click();
  const sheet = page.locator('.dataset-sheet');
  await sheet
    .getByTitle('Создать привязанный объект на canvas')
    .first()
    .click();
  await expect(sheet).toHaveCount(0);
  await page.getByTitle('Файлы и импорт/экспорт', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Скачать архив доски JSON', exact: true })
    .click();
  const result = await download,
    path = info.outputPath('board.modelboard.json');
  await result.saveAs(path);
  const archive = JSON.parse(await readFile(path, 'utf8'));
  expect(archive.files).toHaveLength(1);
  expect(archive.datasets).toHaveLength(1);
  expect(archive.nodes.some((n: any) => n.data?.binding)).toBeTruthy();
  await page.getByLabel('Закрыть файлы').click();
  await drop(page, [
    {
      name: 'board.modelboard.json',
      buffer: Buffer.from(JSON.stringify(archive)),
      type: 'application/json',
    },
  ]);
  await expect(
    page.getByRole('dialog', { name: 'Импорт файлов' }),
  ).toContainText('отдельная доска');
  const response = page.waitForResponse((r) =>
    r.url().endsWith(`/workspaces/${workspace}/boards/import`),
  );
  await page
    .getByRole('button', { name: 'Создать доску из архива', exact: true })
    .click();
  const restored = await (await response).json();
  boards.push(restored.id);
  await expect(page.locator('.image-node img')).toBeVisible();
  await expect(page.locator('.bound-data')).toContainText('api-01');
  const restoredData = (
    await pool.query(
      'SELECT DISTINCT dataset_id FROM board_object_index WHERE board_id=$1 AND dataset_id IS NOT NULL',
      [restored.id],
    )
  ).rows.map((r) => r.dataset_id);
  datasets.push(...restoredData);
  expect(restoredData[0]).not.toBe(imported.datasets[0].id);
  const restoredAssets = (
    await pool.query(
      'SELECT state FROM collab_documents WHERE document_name=$1',
      [`board:${restored.id}`],
    )
  ).rows;
  expect(restoredAssets).toHaveLength(1);
  const fileList = await (
    await request.get(`${base}/workspaces/${workspace}/files`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  for (const f of fileList.filter(
    (f: any) => f.name === 'tiny.png' && !assets.includes(f.id),
  ))
    assets.push(f.id);
  const viewer = await browser.newPage();
  try {
    await login(viewer, restored.id, 'VIEWER');
    await expect(viewer.locator('.image-node img')).toBeVisible();
  } finally {
    await viewer.close();
  }
  expect(
    (
      await request.post(`${base}/workspaces/${workspace}/files/import`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
        data: {
          datasets: [],
          files: [
            {
              name: 'x.png',
              mime: 'image/png',
              base64: png.toString('base64'),
            },
          ],
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(`${base}/files/${imported.files[0].id}/content`)
    ).status(),
  ).toBe(401);
});

test('portable archive remaps relations, formulas, views, groups and SVG templates atomically', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const make = (name: string, fields: string[], values: any[]) => {
    const cols = fields.map((name, i) => ({
      id: randomUUID(),
      name,
      dataType: i ? 'NUMBER' : 'TEXT',
      ordinal: i,
    }));
    const row = {
      id: randomUUID(),
      ordinal: 0,
      values: Object.fromEntries(cols.map((c, i) => [c.id, values[i]])),
    };
    return {
      id: randomUUID(),
      workspaceId: workspace,
      name,
      kind: 'CSV',
      columns: cols,
      rows: [row],
      formulas: [],
      formats: [],
      views: [],
      rules: [],
    };
  };
  const a: any = make('Source', ['name', 'qty', 'total'], ['host-a', 2, 4]);
  a.formulas = [
    {
      rowId: a.rows[0].id,
      columnId: a.columns[2].id,
      expression: `=#{${a.rows[0].id}}@{${a.columns[1].id}}*2`,
    },
  ];
  a.formats = [
    {
      rowId: a.rows[0].id,
      columnId: a.columns[2].id,
      bold: true,
      background: '#ff0000',
    },
  ];
  a.views = [
    {
      id: randomUUID(),
      name: 'Filtered',
      query: '',
      filters: { [a.columns[0].id]: 'host-a' },
      sort: [],
      hiddenColumns: [a.columns[2].id],
      columnWidths: { [a.columns[0].id]: 220 },
      frozenRows: 1,
      frozenColumns: 0,
    },
  ];
  const b: any = make('Children', ['parent', 'value'], ['host-a', 5]);
  const batch = await request.post(
    `${base}/workspaces/${workspace}/files/import`,
    { headers, data: { datasets: [a, b], files: [] } },
  );
  expect(batch.ok()).toBeTruthy();
  const ids = (await batch.json()).datasets.map((d: any) => d.id);
  datasets.push(...ids);
  const source = (
      await pool.query(
        'SELECT id,name FROM dataset_columns WHERE dataset_id=$1 ORDER BY ordinal',
        [ids[0]],
      )
    ).rows,
    target = (
      await pool.query(
        'SELECT id,name FROM dataset_columns WHERE dataset_id=$1 ORDER BY ordinal',
        [ids[1]],
      )
    ).rows;
  const sourceRow = (
      await pool.query('SELECT id FROM dataset_rows WHERE dataset_id=$1', [
        ids[0],
      ])
    ).rows[0].id,
    targetRow = (
      await pool.query('SELECT id FROM dataset_rows WHERE dataset_id=$1', [
        ids[1],
      ])
    ).rows[0].id;
  const field = await (
    await request.post(`${base}/workspaces/${workspace}/relations`, {
      headers,
      data: {
        sourceDatasetId: ids[0],
        sourceColumnId: source[0].id,
        targetDatasetId: ids[1],
        targetColumnId: target[0].id,
        relationType: 'FOREIGN_KEY',
        cardinality: '1:N',
      },
    })
  ).json();
  const records = await (
    await request.post(`${base}/workspaces/${workspace}/relations`, {
      headers,
      data: {
        sourceDatasetId: ids[0],
        sourceColumnId: '__row__',
        targetDatasetId: ids[1],
        targetColumnId: '__row__',
        relationType: 'REFERENCE',
        cardinality: '1:N',
        matchMode: 'ROW_LINKS',
        links: [{ sourceRowId: sourceRow, targetRowId: targetRow }],
      },
    })
  ).json();
  const template = await (
    await request.post(`${base}/workspaces/${workspace}/templates`, {
      headers,
      data: {
        name: `Portable SVG ${randomUUID()}`,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80" fill="red"/></svg>',
        defaultWidth: 100,
        defaultHeight: 80,
      },
    })
  ).json();
  templates.push(template.id);
  const state = {
    nodes: [
      {
        id: 'frame',
        type: 'frame',
        position: { x: 0, y: 0 },
        style: { width: 700, height: 400 },
        data: { text: 'Group' },
      },
      {
        id: 'table',
        type: 'table',
        position: { x: 30, y: 50 },
        data: { datasetId: ids[0], containerId: 'frame' },
      },
      {
        id: 'svg',
        type: 'template',
        position: { x: 350, y: 50 },
        data: {
          templateId: template.id,
          containerId: 'frame',
          binding: {
            id: randomUUID(),
            boardId,
            boardObjectId: 'svg',
            type: 'ROW',
            datasetId: ids[0],
            rowId: sourceRow,
            presentation: { titleColumnId: source[0].id },
          },
        },
      },
      {
        id: 'relation',
        type: 'relationView',
        position: { x: 300, y: 220 },
        data: {
          relationId: records.id,
          parentNodeId: 'svg',
          binding: {
            id: randomUUID(),
            boardId,
            boardObjectId: 'relation',
            type: 'RELATION_VIEW',
            datasetId: ids[0],
            rowId: sourceRow,
            relationPath: [records.id],
            presentation: {},
          },
        },
      },
    ],
    edges: [
      {
        id: 'edge',
        source: 'table',
        target: 'svg',
        sourceHandle: `source:${source[0].id}`,
        data: { relationId: field.id },
      },
    ],
    strokes: [],
  };
  const exported = await request.post(`${base}/boards/${boardId}/export`, {
    headers,
    data: state,
  });
  expect(exported.ok()).toBeTruthy();
  const archive = await exported.json();
  expect(archive.relations).toHaveLength(2);
  const imported = await request.post(
    `${base}/workspaces/${workspace}/boards/import`,
    { headers, data: archive },
  );
  expect(imported.ok()).toBeTruthy();
  const board = await imported.json();
  boards.push(board.id);
  const newIds = (
    await pool.query(
      'SELECT DISTINCT dataset_id FROM board_object_index WHERE board_id=$1 AND dataset_id IS NOT NULL',
      [board.id],
    )
  ).rows.map((r) => r.dataset_id);
  datasets.push(...newIds);
  const newRelations = (
    await pool.query(
      'SELECT * FROM dataset_relations WHERE source_dataset_id=ANY($1::uuid[])',
      [newIds],
    )
  ).rows;
  expect(newRelations).toHaveLength(2);
  for (const r of newRelations) {
    const validation = await (
      await request.get(
        `${base}/workspaces/${workspace}/relations/${r.id}/validation`,
        { headers },
      )
    ).json();
    expect(validation.valid).toBe(true);
  }
  const newSource = newRelations[0].source_dataset_id,
    newSourceCols = (
      await pool.query(
        'SELECT * FROM dataset_columns WHERE dataset_id=$1 ORDER BY ordinal',
        [newSource],
      )
    ).rows;
  const formulas = (
    await pool.query('SELECT * FROM dataset_formulas WHERE dataset_id=$1', [
      newSource,
    ])
  ).rows;
  expect(formulas[0].expression).not.toContain(sourceRow);
  expect(formulas[0].expression).toContain(newSourceCols[1].id);
  const settings = (
    await pool.query(
      'SELECT settings FROM dataset_sheet_settings WHERE dataset_id=$1',
      [newSource],
    )
  ).rows[0].settings;
  expect(settings.views[0].columnWidths[newSourceCols[0].id]).toBe(220);
  const newTemplate = (
    await pool.query(
      'SELECT properties FROM board_object_index WHERE board_id=$1 AND object_type=$2',
      [board.id, 'template'],
    )
  ).rows[0].properties;
  templates.push(newTemplate.templateId);
  await login(page, board.id);
  await expect(page.locator('.template-node img')).toBeVisible();
  await expect(page.locator('.bound-data')).toContainText('host-a');
  // An invalid asset must roll back the whole import, including the otherwise valid dataset.
  const before = Number(
    (
      await pool.query('SELECT count(*) FROM datasets WHERE workspace_id=$1', [
        workspace,
      ])
    ).rows[0].count,
  );
  const rejected = await request.post(
    `${base}/workspaces/${workspace}/files/import`,
    {
      headers,
      data: {
        datasets: [a],
        files: [
          {
            name: 'bad.svg',
            mime: 'image/svg+xml',
            base64: Buffer.from(
              '<svg><script>alert(1)</script></svg>',
            ).toString('base64'),
          },
        ],
      },
    },
  );
  expect(rejected.status()).toBe(400);
  expect(
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM datasets WHERE workspace_id=$1',
          [workspace],
        )
      ).rows[0].count,
    ),
  ).toBe(before);
});

test('cancelled import writes nothing and snapshots export as PNG and SVG', async ({
  page,
}, info) => {
  const before = Number(
    (
      await pool.query('SELECT count(*) FROM datasets WHERE workspace_id=$1', [
        workspace,
      ])
    ).rows[0].count,
  );
  await drop(page, [
    {
      name: 'cancel.csv',
      buffer: Buffer.from('name\nignored\n'),
      type: 'text/csv',
    },
  ]);
  const importDialog = page.getByRole('dialog', { name: 'Импорт файлов' });
  await expect(importDialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(importDialog).toHaveCount(0);
  expect(
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM datasets WHERE workspace_id=$1',
          [workspace],
        )
      ).rows[0].count,
    ),
  ).toBe(before);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(0);
  await page.getByTitle('Фигура', { exact: true }).click();
  await page
    .locator('.react-flow__pane')
    .click({ position: { x: 450, y: 300 } });
  await drop(page, [{ name: 'snapshot.png', buffer: png, type: 'image/png' }]);
  await confirm(page);
  await page.getByTitle('Файлы и импорт/экспорт', { exact: true }).click();
  for (const format of ['PNG', 'SVG']) {
    const promised = page.waitForEvent('download');
    await page
      .getByRole('button', { name: `Экспорт ${format}`, exact: true })
      .click();
    const download = await promised,
      path = info.outputPath(`board.${format.toLowerCase()}`);
    await download.saveAs(path);
    const content = await readFile(path);
    if (format === 'PNG')
      expect(
        content
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      ).toBe(true);
    else expect(content.toString('utf8')).toContain('<svg');
  }
});

test('JSON scalar types and 10000 records survive one drop; oversized XLSX is rejected before import', async ({
  page,
}) => {
  const records = Array.from({ length: 10000 }, (_, i) => ({
    code: String(i).padStart(5, '0'),
    textNumber: '123',
    count: i,
    active: i % 2 === 0,
  }));
  await drop(page, [
    {
      name: 'records.json',
      buffer: Buffer.from(JSON.stringify(records)),
      type: 'application/json',
    },
  ]);
  const preview = page.getByRole('dialog', { name: 'Импорт файлов' });
  await expect(preview).toContainText('10000 строк');
  const imported = await confirm(page);
  const columns = (
    await pool.query(
      'SELECT id,name,data_type FROM dataset_columns WHERE dataset_id=$1',
      [imported.datasets[0].id],
    )
  ).rows;
  expect(columns.find((c) => c.name === 'textNumber').data_type).toBe('TEXT');
  const data = (
    await pool.query(
      'SELECT values FROM dataset_rows WHERE dataset_id=$1 ORDER BY ordinal LIMIT 1',
      [imported.datasets[0].id],
    )
  ).rows[0].values;
  expect(data[columns.find((c) => c.name === 'code').id]).toBe('00000');
  expect(data[columns.find((c) => c.name === 'textNumber').id]).toBe('123');
  expect(data[columns.find((c) => c.name === 'count').id]).toBe(0);
  expect(data[columns.find((c) => c.name === 'active').id]).toBe(true);
  const zip = Buffer.alloc(68);
  zip.writeUInt32LE(0x02014b50, 0);
  zip.writeUInt32LE(60 * 1024 * 1024, 24);
  zip.writeUInt32LE(0x06054b50, 46);
  zip.writeUInt16LE(1, 56);
  zip.writeUInt32LE(0, 62);
  await drop(page, [
    {
      name: 'oversized.xlsx',
      buffer: zip,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  ]);
  await expect(page.locator('.csv-drop-error')).toContainText('50 МБ');
  await expect(page.getByRole('dialog', { name: 'Импорт файлов' })).toHaveCount(
    0,
  );
});
