import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { buildCsvImportDraft } from '../apps/web/src/lib/csv.ts';
const {
  validateBoardArchive,
  remapBoardArchive,
  assertSafeJson,
  validateDatasetFile,
} = await tsImport('../packages/shared/src/files.ts', import.meta.url);
const archive = () => ({
  format: 'modelboard',
  version: 1,
  name: 'Example',
  nodes: [
    {
      id: 'node-a',
      type: 'table',
      position: { x: 10, y: 20 },
      data: { datasetId: 'dataset-a' },
    },
    {
      id: 'node-b',
      type: 'device',
      position: { x: 50, y: 30 },
      data: {
        label: 'dataset-a',
        binding: {
          id: 'binding',
          type: 'ROW',
          datasetId: 'dataset-a',
          rowId: 'row-a',
          presentation: { titleColumnId: 'column-a' },
        },
      },
    },
  ],
  edges: [
    {
      id: 'edge-a',
      source: 'node-a',
      target: 'node-b',
      sourceHandle: 'source:column-a',
    },
  ],
  strokes: [],
  datasets: [
    {
      id: 'dataset-a',
      workspaceId: 'old-workspace',
      name: 'Data',
      kind: 'CSV',
      columns: [
        { id: 'column-a', name: 'name', dataType: 'TEXT', ordinal: 0 },
        { id: 'column-b', name: 'number', dataType: 'NUMBER', ordinal: 1 },
      ],
      rows: [
        {
          id: 'row-a',
          ordinal: 0,
          values: { 'column-a': 'dataset-a', 'column-b': 42 },
        },
      ],
      formulas: [
        {
          rowId: 'row-a',
          columnId: 'column-b',
          expression: '=#{row-a}@{column-b}+1',
        },
      ],
      formats: [],
      views: [
        {
          id: 'view-a',
          name: 'Filter',
          filters: { 'column-a': 'contains api' },
          columnWidths: { 'column-a': 200 },
          sort: [{ columnId: 'column-a', direction: 'asc' }],
          hiddenColumns: ['column-b'],
        },
      ],
      rules: [],
    },
  ],
  relations: [],
  templates: [],
  files: [],
});
test('archive remaps identities, formulas, handles and saved views without rewriting business values or labels', () => {
  const original = archive();
  original.datasets[0].formulas[0].expression =
    '=#{row-a}@{column-b}&"#{row-a}@{column-b}"&\'@{column-a}\'';
  validateBoardArchive(original);
  let i = 0;
  const copy = remapBoardArchive(original, () => `new-${++i}`);
  validateBoardArchive(copy);
  assert.notEqual(copy.nodes[0].id, original.nodes[0].id);
  assert.equal(copy.nodes[1].data.label, 'dataset-a');
  assert.equal(
    copy.datasets[0].rows[0].values[copy.datasets[0].columns[0].id],
    'dataset-a',
  );
  assert.equal(copy.nodes[1].data.binding.rowId, copy.datasets[0].rows[0].id);
  assert.equal(
    copy.edges[0].sourceHandle,
    'source:' + copy.datasets[0].columns[0].id,
  );
  assert.ok(
    copy.datasets[0].formulas[0].expression.includes(
      copy.datasets[0].rows[0].id,
    ),
  );
  assert.equal(
    copy.datasets[0].formulas[0].expression,
    `=#{${copy.datasets[0].rows[0].id}}@{${copy.datasets[0].columns[1].id}}&"#{row-a}@{column-b}"&'@{column-a}'`,
  );
  assert.equal(
    copy.datasets[0].views[0].columnWidths[copy.datasets[0].columns[0].id],
    200,
  );
  assert.equal(original.datasets[0].columns[0].id, 'column-a');
});
test('unknown references, cycles, invalid versions, duplicate identities and prototype keys are rejected', () => {
  const a = archive();
  a.nodes[0].data.datasetId = 'missing';
  assert.throws(() => validateBoardArchive(a));
  const b = archive();
  b.nodes[0].parentId = 'node-b';
  b.nodes[1].parentId = 'node-a';
  assert.throws(() => validateBoardArchive(b));
  assert.throws(() => validateBoardArchive({ ...archive(), version: 999 }));
  const c = archive();
  c.nodes[1].id = c.nodes[0].id;
  assert.throws(() => validateBoardArchive(c));
  assert.throws(() => assertSafeJson(JSON.parse('{"__proto__":{"x":true}}')));
  assert.throws(() =>
    validateDatasetFile({
      ...archive().datasets[0],
      rows: [{ id: 'r', values: { missing: 'x' } }],
    }),
  );
});

test('CSV infers mixed numeric values while preserving identifiers, large integers and unique headers', () => {
  const draft = buildCsvImportDraft(
    {
      fileName: 'metrics.csv',
      fileSize: 0,
      delimiter: ',',
      matrix: [
        ['code', 'amount', 'large', 'a', 'a', 'a_2'],
        ['001', '1', '9007199254740993', 'x', 'y', 'z'],
        ['002', '2.5', '9007199254740995', '', '', ''],
      ],
    },
    true,
  );
  assert.equal(draft.columns[0].dataType, 'TEXT');
  assert.equal(draft.columns[1].dataType, 'NUMBER');
  assert.equal(draft.columns[2].dataType, 'TEXT');
  assert.equal(new Set(draft.columns.map((c) => c.name)).size, 6);
  assert.equal(draft.rows[0].values[draft.columns[0].id], '001');
  assert.equal(draft.rows[1].values[draft.columns[1].id], 2.5);
  assert.equal(draft.rows[0].values[draft.columns[2].id], '9007199254740993');
});
