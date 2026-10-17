import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPersistCanvasNodeChange } from '../apps/web/src/lib/canvasInteraction.ts';

test('selection is local to the user and never sent to Yjs', () => {
  assert.equal(shouldPersistCanvasNodeChange({type:'select'}), false);
});

test('pointer movement and active resize are preview-only', () => {
  assert.equal(shouldPersistCanvasNodeChange({type:'position',dragging:true}), false);
  assert.equal(shouldPersistCanvasNodeChange({type:'dimensions',resizing:true}), false);
});

test('final coordinates, dimensions, additions and removals are persisted', () => {
  assert.equal(shouldPersistCanvasNodeChange({type:'position',dragging:false}), true);
  assert.equal(shouldPersistCanvasNodeChange({type:'position'}), true);
  assert.equal(shouldPersistCanvasNodeChange({type:'dimensions',resizing:false}), true);
  assert.equal(shouldPersistCanvasNodeChange({type:'add'}), true);
  assert.equal(shouldPersistCanvasNodeChange({type:'remove'}), true);
});

const { reconcileCanvasNodes, persistedCanvasGeometry } = await import('../apps/web/src/lib/canvasInteraction.ts');

test('incoming edits preserve active local geometry and selection while applying remote data', () => {
  const current = [{ id: 'a', position: { x: 80, y: 40 }, selected: true }];
  const previews = new Map([['a', { position: current[0].position, dragging: true }]]);
  const shared = [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'remote edit' } },
    { id: 'b', position: { x: 20, y: 10 } }];
  const result = reconcileCanvasNodes(shared, current, previews);
  assert.deepEqual(result[0].position, { x: 80, y: 40 });
  assert.deepEqual(result[0].data, { label: 'remote edit' });
  assert.equal(result[0].selected, true);
  assert.equal(result[1].selected, false);
  previews.clear();
  assert.deepEqual(reconcileCanvasNodes(shared, result, previews)[0].position, { x: 0, y: 0 });
});

test('remote deletion discards the preview and never recreates the node', () => {
  const previews = new Map([['a', { position: { x: 80, y: 40 } }]]);
  assert.deepEqual(reconcileCanvasNodes([], [{ id: 'a' }], previews), []);
  assert.equal(previews.size, 0);
});

test('final geometry commits retain concurrent edits and exclude local selection', () => {
  const shared = { id: 'a', data: { label: 'remote edit' }, style: { color: 'red' }, selected: false };
  const local = { id: 'a', position: { x: 80, y: 40 }, data: { label: 'old' }, selected: true,
    width: 240, height: 120, measured: { width: 240, height: 120 } };
  const moved = persistedCanvasGeometry(shared, local, 'position');
  assert.deepEqual(moved.data, shared.data);
  assert.deepEqual(moved.style, shared.style);
  assert.equal(moved.selected, false);
  assert.equal(moved.dragging, false);
  const resized = persistedCanvasGeometry(shared, local, 'dimensions');
  assert.equal(resized.width, 240);
  assert.equal(resized.height, 120);
  assert.deepEqual(resized.style, shared.style);
  assert.equal(resized.resizing, false);
});

test('a frame and its contents undo together, successive gestures stay separate', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  const original = [
    { id: 'frame', position: { x: 0, y: 0 } },
    { id: 'child', position: { x: 40, y: 50 } },
  ];
  for (const node of original) nodes.set(node.id, node);
  const undo = new Y.UndoManager(nodes, { captureTimeout: 350 });
  let updates = 0;
  doc.on('update', () => updates++);
  const previews = new Map();
  let local = original;
  for (let x = 1; x <= 100; x++) {
    for (const node of original) previews.set(node.id, {
      position: { x: node.position.x + x, y: node.position.y }, dragging: true,
    });
    local = reconcileCanvasNodes(Array.from(nodes.values()), local, previews);
  }
  assert.equal(updates, 0, 'pointer previews do not write to the shared document');
  undo.stopCapturing();
  // React Flow finishes the frame before the drag-stop handler commits its contents.
  nodes.set('frame', persistedCanvasGeometry(nodes.get('frame'), local[0], 'position'));
  nodes.set('child', persistedCanvasGeometry(nodes.get('child'), local[1], 'position'));
  undo.stopCapturing();
  assert.equal(undo.undoStack.length, 1);
  nodes.set('child', { ...nodes.get('child'), position: { x: 200, y: 50 } });
  undo.stopCapturing();
  undo.undo();
  assert.equal(nodes.get('frame').position.x, 100);
  assert.equal(nodes.get('child').position.x, 140);
  undo.undo();
  assert.equal(nodes.get('frame').position.x, 0);
  assert.equal(nodes.get('child').position.x, 40);
  undo.redo();
  assert.equal(nodes.get('frame').position.x, 100);
  assert.equal(nodes.get('child').position.x, 140);
  undo.destroy();
  doc.destroy();
});

test('initial layout measurements stay local and never become an extra Undo step', () => {
  assert.equal(shouldPersistCanvasNodeChange({ type: 'dimensions' }), false);
  assert.equal(shouldPersistCanvasNodeChange({ type: 'dimensions', setAttributes: true }), true);
  const current = [{ id: 'a', width: 100, height: 80, measured: { width: 100, height: 80 }, selected: true }];
  const shared = [{ id: 'a', width: 100, height: 80, data: { text: 'remote edit' } }];
  const synced = reconcileCanvasNodes(shared, current, new Map());
  assert.deepEqual(synced[0].measured, current[0].measured);
  assert.deepEqual(synced[0].data, shared[0].data);
  const resized = reconcileCanvasNodes([{ ...shared[0], width: 200 }], current, new Map());
  assert.equal(resized[0].measured, undefined, 'remote size changes invalidate stale measurements');
});

test('copy creation is removed by one Undo even after its local dimensions are measured', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  const undo = new Y.UndoManager(nodes);
  undo.stopCapturing();
  nodes.set('copy', { id: 'copy', position: { x: 80, y: 90 }, data: { text: 'copy' } });
  undo.stopCapturing();
  const local = [{ ...nodes.get('copy'), measured: { width: 140, height: 84 } }];
  if (shouldPersistCanvasNodeChange({ type: 'dimensions' })) nodes.set('copy', local[0]);
  assert.equal(undo.undoStack.length, 1);
  assert.deepEqual(reconcileCanvasNodes(Array.from(nodes.values()), local, new Map())[0].measured, local[0].measured);
  undo.undo();
  assert.equal(nodes.has('copy'), false);
  undo.redo();
  assert.equal(nodes.get('copy').data.text, 'copy');
  undo.destroy();
  doc.destroy();
});
