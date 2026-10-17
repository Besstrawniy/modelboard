import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCanvasObject, listCanvasObjects, selectCanvasObjectIds } from '../apps/web/src/lib/canvasObjects.ts';
import { reorderCanvasLayers } from '../apps/web/src/lib/canvasGeometry.ts';
import { reconcileCanvasNodes } from '../apps/web/src/lib/canvasInteraction.ts';

test('the object list follows reverse paint order, with stable ties and frames behind content', () => {
  const nodes = [
    { id: 'frame', type: 'frame', zIndex: -10 },
    { id: 'first', type: 'shape' },
    { id: 'second', type: 'shape' },
    { id: 'top', type: 'sticky', zIndex: 10 },
  ];
  const original = structuredClone(nodes);
  assert.deepEqual(listCanvasObjects(nodes, '').map((node) => node.id), ['top', 'second', 'first', 'frame']);
  assert.deepEqual(nodes, original);
});

test('names come from stored labels and text, normalize whitespace and safely fall back to the type', () => {
  assert.equal(describeCanvasObject({ id: 'a', type: 'sticky', data: { text: '  Первый\n  стикер  ' } }).name, 'Первый стикер');
  assert.equal(describeCanvasObject({ id: 'b', type: 'frame', data: { title: 'Стойка 1', text: 'Описание' } }).name, 'Стойка 1');
  assert.equal(describeCanvasObject({ id: 'c', type: 'device', data: { deviceKind: 'ROUTER' } }).name, 'Маршрутизатор');
  assert.equal(describeCanvasObject({ id: 'd', type: 'table', data: { text: 123 } }).name, 'Таблица');
  assert.equal(describeCanvasObject({ id: 'e', type: 'future-type' }).name, 'Объект');
});

test('search matches all words across name and type, independent of case and whitespace', () => {
  const nodes = [
    { id: 'a', type: 'device', data: { deviceKind: 'SERVER', label: 'Почта — Москва' } },
    { id: 'b', type: 'device', data: { deviceKind: 'ROUTER', label: 'Маршрутизатор — Москва' } },
    { id: 'c', type: 'sticky', data: { text: 'Почта' } },
  ];
  assert.deepEqual(listCanvasObjects(nodes, '  МОСКВА   сервер ').map((node) => node.id), ['a']);
  assert.deepEqual(listCanvasObjects(nodes, 'Стикер Почта').map((node) => node.id), ['c']);
  assert.deepEqual(listCanvasObjects(nodes, 'несуществующий'), []);
});

const selection = (patch = {}) => selectCanvasObjectIds({ currentIds: ['hidden', 'a'], visibleIds: ['a', 'b', 'c', 'd'],
  targetId: 'c', anchorId: 'a', toggle: false, range: false, ...patch });

test('plain click replaces selection; Ctrl/Command toggles one object and preserves filtered-out selection', () => {
  assert.deepEqual(selection(), ['c']);
  assert.deepEqual(selection({ toggle: true }), ['hidden', 'a', 'c']);
  assert.deepEqual(selection({ toggle: true, targetId: 'a' }), ['hidden']);
});

test('Shift selects the displayed range in either direction; Ctrl+Shift adds the range', () => {
  assert.deepEqual(selection({ range: true }), ['a', 'b', 'c']);
  assert.deepEqual(selection({ range: true, anchorId: 'd', targetId: 'b' }), ['b', 'c', 'd']);
  assert.deepEqual(selection({ range: true, toggle: true }), ['hidden', 'a', 'b', 'c']);
});

test('a filtered or deleted anchor falls back safely; a stale target leaves selection intact', () => {
  assert.deepEqual(selection({ range: true, anchorId: 'filtered-out' }), ['c']);
  assert.deepEqual(selection({ range: true, anchorId: null }), ['c']);
  assert.deepEqual(selection({ targetId: 'deleted' }), ['hidden', 'a']);
});

test('layer operations update the object list immediately and can be undone', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const map = doc.getMap('nodes');
  const nodes = ['a', 'b', 'c'].map((id) => ({ id, type: 'shape', position: { x: 0, y: 0 } }));
  nodes.forEach((node) => map.set(node.id, node));
  const undo = new Y.UndoManager(map);
  const layers = reorderCanvasLayers(nodes, new Set(['a']), 'front');
  doc.transact(() => layers.forEach((zIndex, id) => map.set(id, { ...map.get(id), zIndex })));
  assert.deepEqual(listCanvasObjects(Array.from(map.values()), '').map((node) => node.id), ['a', 'c', 'b']);
  undo.undo();
  assert.deepEqual(listCanvasObjects(Array.from(map.values()), '').map((node) => node.id), ['c', 'b', 'a']);
  undo.destroy();
  doc.destroy();
});

test('panel selection stays local through a shared-data refresh and creates no undo item', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const map = doc.getMap('nodes');
  map.set('a', { id: 'a', data: { text: 'a' } });
  map.set('b', { id: 'b', data: { text: 'b' } });
  const undo = new Y.UndoManager(map);
  const ids = selectCanvasObjectIds({ currentIds: [], visibleIds: ['a', 'b'], targetId: 'b', anchorId: null, toggle: false, range: false });
  const local = Array.from(map.values()).map((node) => ({ ...node, selected: ids.includes(node.id) }));
  const refreshed = reconcileCanvasNodes(Array.from(map.values()), local, new Map());
  assert.deepEqual(refreshed.filter((node) => node.selected).map((node) => node.id), ['b']);
  assert.equal(map.get('b').selected, undefined);
  assert.equal(undo.undoStack.length, 0);
  undo.destroy();
  doc.destroy();
});
