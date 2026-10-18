import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  validateRelationData,
  relationValueKey,
} from '../packages/shared/src/relations.ts';
import { resolveBindingPresentation } from '../packages/shared/src/bindingPresentation.ts';
import { cleanBoardResources } from '../packages/shared/src/resourceLifecycle.ts';
import { CanvasNodeStore } from '../packages/shared/src/canvasDocument.ts';
import { canvasInsertionPosition } from '../apps/web/src/lib/canvasGeometry.ts';
const rows = (values, column) =>
  values.map((value, index) => ({
    id: `row${index}`,
    ordinal: index,
    values: { [column]: value },
  }));
const relation = {
  sourceColumnId: 'host',
  targetColumnId: 'id',
  relationType: 'FOREIGN_KEY',
  cardinality: 'N:1',
};
test('FK accepts repeated source keys, rejects duplicate targets and non-null orphans', () => {
  assert.equal(
    validateRelationData(relation, rows([1, 1, null], 'host'), rows([1], 'id'))
      .valid,
    true,
  );
  assert.equal(
    validateRelationData(relation, rows([1, 2], 'host'), rows([1, 1], 'id'))
      .valid,
    false,
  );
  const report = validateRelationData(
    relation,
    rows([2, null, ''], 'host'),
    rows([1], 'id'),
  );
  assert.equal(report.orphanCount, 1);
  assert.deepEqual(report.orphanRowIds, ['row0']);
});
test('cardinality checks both directions, reference orphans are optional and key types stay distinct', () => {
  assert.equal(
    validateRelationData(
      { ...relation, relationType: 'REFERENCE', cardinality: '1:N' },
      rows([1, 1], 'host'),
      rows([1], 'id'),
    ).valid,
    false,
  );
  assert.equal(
    validateRelationData(
      { ...relation, relationType: 'REFERENCE', cardinality: 'N:M' },
      rows([1, 1], 'host'),
      rows([2, 2], 'id'),
    ).valid,
    true,
  );
  assert.notEqual(relationValueKey('001'), relationValueKey(1));
  assert.notEqual(relationValueKey('1'), relationValueKey(1));
});
const dataset = {
  id: 'data',
  name: 'Servers',
  columns: [
    { id: 'hostname', name: 'Hostname' },
    { id: 'ip', name: 'IP' },
    { id: 'cost', name: 'Cost' },
    { id: 'status', name: 'Status' },
  ],
  rows: [
    {
      id: 'a',
      values: { hostname: 'api-01', ip: '10.0.0.1', cost: 10, status: 'up' },
    },
    { id: 'b', values: { hostname: 'db-01', cost: 20 } },
  ],
};
test('row presentation resolves configured fields, labels and status without copying stored data', () => {
  const model = resolveBindingPresentation(
    {
      type: 'ROW',
      datasetId: 'data',
      rowId: 'a',
      presentation: {
        titleColumnId: 'hostname',
        subtitleColumnId: 'ip',
        fieldColumnIds: ['cost'],
        statusColumnId: 'status',
        statusColors: { up: '#22aa55' },
      },
    },
    dataset,
  );
  assert.equal(model.title, 'api-01');
  assert.equal(model.subtitle, '10.0.0.1');
  assert.equal(model.fields[0].value, '10');
  assert.equal(model.color, '#22aa55');
  assert.equal(model.missing, false);
  const changed = {
    ...dataset,
    rows: dataset.rows.map((row) =>
      row.id === 'a'
        ? { ...row, values: { ...row.values, ip: '10.0.0.2' } }
        : row,
    ),
  };
  assert.equal(
    resolveBindingPresentation(
      { type: 'CELL', datasetId: 'data', rowId: 'a', columnId: 'ip' },
      changed,
    ).subtitle,
    '10.0.0.2',
  );
});
test('Dataset, Column aggregates, Cell and missing sources have explicit presentations', () => {
  assert.match(
    resolveBindingPresentation({ type: 'DATASET' }, dataset).subtitle,
    /2 строк/,
  );
  for (const [aggregation, value] of [
    ['COUNT', 2],
    ['SUM', 30],
    ['AVG', 15],
    ['MIN', 10],
    ['MAX', 20],
    ['FIRST', 10],
  ])
    assert.equal(
      resolveBindingPresentation(
        { type: 'COLUMN', columnId: 'cost', presentation: { aggregation } },
        dataset,
      ).subtitle,
      `${aggregation}: ${value}`,
    );
  assert.equal(
    resolveBindingPresentation(
      { type: 'CELL', columnId: 'ip', rowId: 'b' },
      dataset,
    ).subtitle,
    '—',
  );
  assert.equal(
    resolveBindingPresentation({ type: 'ROW', rowId: 'missing' }, dataset)
      .missing,
    true,
  );
});
test('resource deletion removes tables, relation views and incident edges while preserving standalone objects', () => {
  const doc = new Y.Doc(),
    store = new CanvasNodeStore(doc);
  const binding = { datasetId: 'deleted', rowId: 'a' };
  store.set('table', {
    id: 'table',
    type: 'table',
    data: { datasetId: 'deleted' },
  });
  store.set('device', {
    id: 'device',
    type: 'device',
    position: { x: 2, y: 3 },
    data: { label: 'Keep me', binding },
  });
  store.set('view', {
    id: 'view',
    type: 'relationView',
    data: { relationId: 'relation', binding: { datasetId: 'other' } },
  });
  store.set('other', { id: 'other', type: 'shape', data: { text: 'Other' } });
  doc.getMap('edges').set('e', { source: 'table', target: 'other' });
  doc
    .getMap('edges')
    .set('r', {
      source: 'device',
      target: 'other',
      data: { relationId: 'relation' },
    });
  cleanBoardResources(doc, new Set(['deleted']), new Set(['relation']));
  assert.equal(store.has('table'), false);
  assert.equal(store.has('view'), false);
  assert.equal(store.get('device').data.binding, null);
  assert.equal(store.get('device').data.label, 'Keep me');
  assert.equal(doc.getMap('edges').size, 0);
  assert.equal(store.has('other'), true);
  cleanBoardResources(doc, new Set(['deleted']), new Set(['relation']));
  assert.equal(store.size, 2);
  doc.destroy();
});
test('palette insertion finds a free slot and ignores container backgrounds', () => {
  const occupied = {
    id: 'a',
    type: 'device',
    position: { x: 0, y: 0 },
    style: { width: 220, height: 170 },
  };
  const next = canvasInsertionPosition([occupied], { x: 110, y: 85 }, 220, 170);
  assert.ok(
    next.x + 220 <= 0 || next.x >= 220 || next.y + 170 <= 0 || next.y >= 170,
  );
  assert.deepEqual(
    canvasInsertionPosition(
      [{ ...occupied, type: 'frame' }],
      { x: 110, y: 85 },
      220,
      170,
    ),
    { x: 0, y: 0 },
  );
});
