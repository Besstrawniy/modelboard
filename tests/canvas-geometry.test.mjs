import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasNodeSize, alignCanvasNodes, distributeCanvasNodes,
  includeCanvasFrameContents, reorderCanvasLayers,
} from '../apps/web/src/lib/canvasGeometry.ts';

const node = (id, x, y, width, height, extra = {}) => ({ id, position: { x, y }, width, height, ...extra });
const selected = (...ids) => new Set(ids);
const applyPositions = (nodes, positions) => nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));

for (const mode of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
  test(`alignment ${mode} uses object bounds and preserves the other coordinate`, () => {
    const nodes = [node('a', -80, -40, 40, 30), node('b', 50, 70, 100, 60), node('other', -900, -900, 1, 1)];
    const snapshot = structuredClone(nodes);
    const targets = alignCanvasNodes(nodes, selected('a', 'b'), mode);
    const result = applyPositions(nodes, targets);
    const fraction = mode === 'center' || mode === 'middle' ? .5 : mode === 'right' || mode === 'bottom' ? 1 : 0;
    const horizontal = ['left', 'center', 'right'].includes(mode);
    const axis = horizontal ? 'x' : 'y';
    const dimension = horizontal ? 'width' : 'height';
    const untouched = horizontal ? 'y' : 'x';
    const expected = horizontal ? -80 + 230 * fraction : -40 + 170 * fraction;
    for (const item of result.slice(0, 2)) {
      assert.equal(item.position[axis] + item[dimension] * fraction, expected);
      assert.equal(item.position[untouched], nodes.find((n) => n.id === item.id).position[untouched]);
    }
    assert.equal(targets.has('other'), false);
    assert.deepEqual(nodes, snapshot, 'geometry calculation is non-destructive');
  });
}

test('dimensions prefer measured values, then explicit and styled sizes, with a safe fallback', () => {
  const item = node('a', 0, 0, 100, 50, { measured: { width: 120 }, style: { width: 90, height: '80' } });
  assert.equal(canvasNodeSize(item, 'width', 180), 120);
  assert.equal(canvasNodeSize({ ...item, measured: {}, width: 0 }, 'width', 180), 90);
  assert.equal(canvasNodeSize({ id: 'a', position: { x: 0, y: 0 }, style: { width: '100%' } }, 'width', 180), 180);
  assert.equal(canvasNodeSize({ ...item, measured: { width: NaN }, width: -1, style: {} }, 'width', 180), 180);
});

for (const mode of ['horizontal', 'vertical']) {
  test(`distribution ${mode} creates equal edge gaps with different sizes and fixes endpoints`, () => {
    const axis = mode === 'horizontal' ? 'x' : 'y';
    const dimension = mode === 'horizontal' ? 'width' : 'height';
    const nodes = [node('a', -30, -30, 20, 20), node('b', 90, 90, 60, 60), node('c', 270, 270, 30, 30)];
    const targets = distributeCanvasNodes(nodes, selected('a', 'b', 'c'), mode);
    const result = applyPositions(nodes, targets);
    const firstGap = result[1].position[axis] - result[0].position[axis] - result[0][dimension];
    const lastGap = result[2].position[axis] - result[1].position[axis] - result[1][dimension];
    assert.equal(firstGap, 110);
    assert.equal(firstGap, lastGap);
    assert.equal(targets.has('a'), false);
    assert.equal(targets.has('c'), false);
    assert.equal(targets.get('b')[axis === 'x' ? 'y' : 'x'], 90);
  });
}

test('too few objects and already aligned selections produce no writes', () => {
  const nodes = [node('a', 0, 0, 100, 80), node('b', 0, 100, 100, 80)];
  assert.equal(alignCanvasNodes(nodes, selected('a'), 'left').size, 0);
  assert.equal(alignCanvasNodes(nodes, selected('a', 'b'), 'left').size, 0);
  assert.equal(distributeCanvasNodes(nodes, selected('a', 'b'), 'horizontal').size, 0);
});

test('frame contents follow the smallest moved enclosing frame once; selected peers use their own targets', () => {
  const nodes = [
    node('large', 0, 0, 500, 400, { type: 'frame' }),
    node('small', 40, 40, 200, 200, { type: 'frame' }),
    node('child', 80, 80, 40, 40),
    node('selected-child', 120, 120, 40, 40),
    node('outside', 800, 800, 40, 40),
  ];
  const targets = new Map([['large', { x: 200, y: 0 }], ['small', { x: 50, y: 60 }],
    ['selected-child', { x: 700, y: 700 }]]);
  const result = includeCanvasFrameContents(nodes, targets, selected('large', 'small', 'selected-child'));
  assert.deepEqual(result.get('child'), { x: 90, y: 100 });
  assert.deepEqual(result.get('selected-child'), { x: 700, y: 700 });
  assert.equal(result.has('outside'), false);
  assert.equal(targets.has('child'), false);
});

function orderedIds(nodes, layers) {
  return nodes.map((node) => ({ ...node, zIndex: layers.get(node.id) ?? node.zIndex ?? 0 }))
    .sort((a, b) => a.zIndex - b.zIndex).map((node) => node.id);
}

for (const [action, expected] of [
  ['front', ['a', 'd', 'e', 'b', 'c']],
  ['back', ['b', 'c', 'a', 'd', 'e']],
  ['forward', ['a', 'd', 'b', 'c', 'e']],
  ['backward', ['b', 'c', 'a', 'd', 'e']],
]) {
  test(`layer action ${action} preserves the relative order of selected objects`, () => {
    const nodes = 'abcde'.split('').map((id, i) => node(id, i, 0, 10, 10));
    const snapshot = structuredClone(nodes);
    assert.deepEqual(orderedIds(nodes, reorderCanvasLayers(nodes, selected('b', 'c'), action)), expected);
    assert.deepEqual(nodes, snapshot);
  });
}

test('layer boundary and empty-selection commands do not write or create undo entries', () => {
  const nodes = [node('frame', 0, 0, 500, 400, { zIndex: -10 }), node('a', 0, 0, 10, 10), node('b', 0, 0, 10, 10)];
  assert.equal(reorderCanvasLayers(nodes, selected('b'), 'front').size, 0);
  assert.equal(reorderCanvasLayers(nodes, selected('frame'), 'back').size, 0);
  assert.equal(reorderCanvasLayers(nodes, selected(), 'forward').size, 0);
  assert.deepEqual(orderedIds(nodes, reorderCanvasLayers(nodes, selected('frame'), 'front')), ['a', 'b', 'frame']);
});

test('a multi-object alignment and a layer command are independent undoable document operations', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const map = doc.getMap('nodes');
  const nodes = [node('a', -40, 30, 50, 30, { data: { text: 'keep' } }), node('b', 80, 70, 90, 50)];
  nodes.forEach((node) => map.set(node.id, node));
  const undo = new Y.UndoManager(map);
  const targets = alignCanvasNodes(nodes, selected('a', 'b'), 'right');
  undo.stopCapturing();
  doc.transact(() => targets.forEach((position, id) => map.set(id, { ...map.get(id), position })));
  undo.stopCapturing();
  const layers = reorderCanvasLayers(Array.from(map.values()), selected('a'), 'front');
  doc.transact(() => layers.forEach((zIndex, id) => map.set(id, { ...map.get(id), zIndex })));
  undo.stopCapturing();
  assert.equal(undo.undoStack.length, 2);
  undo.undo();
  assert.equal(map.get('a').position.x, 120);
  undo.undo();
  assert.equal(map.get('a').position.x, -40);
  assert.deepEqual(map.get('a').data, { text: 'keep' });
  undo.redo();
  assert.equal(map.get('a').position.x, 120);
  undo.destroy();
  doc.destroy();
});
