import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freehandPath, flattenFreehandStroke, pointSegmentDistance, eraserHitsStroke, appendFreehandPoint,
} from '../apps/web/src/lib/freehandGeometry.ts';

const point = (x, y) => ({ x, y });
const stroke = (points, width = 2) => ({ points, width });

test('the eraser hits the middle of a sparse stroke, not only its samples', () => {
  const line = stroke([point(0, 0), point(1000, 0)]);
  assert.equal(eraserHitsStroke(line, point(500, 4), point(500, 4), 1), true);
  assert.equal(eraserHitsStroke(line, point(500, 20), point(500, 20), 1), false);
});

test('fast eraser movement sweeps the whole path between pointer events', () => {
  const line = stroke([point(0, 0), point(1000, 0)]);
  assert.equal(eraserHitsStroke(line, point(500, -100), point(500, 100), 1), true);
  assert.equal(eraserHitsStroke(line, point(500, 100), point(500, -100), 1), true);
  assert.equal(eraserHitsStroke(line, point(1200, -100), point(1200, 100), 1), false);
});

test('collinear but disjoint segments are not reported as crossings', () => {
  const line = stroke([point(0, 0), point(100, 0)]);
  assert.equal(eraserHitsStroke(line, point(200, 0), point(300, 0), 1), false);
  assert.equal(eraserHitsStroke(line, point(50, 0), point(200, 0), 1), true);
});

test('hit testing follows the smoothed quadratic path instead of the raw point polygon', () => {
  const curve = stroke([point(0, 0), point(100, 100), point(200, 0)]);
  // Midpoint of Q(0,0 100,100 150,50), visibly away from the raw sample edges.
  assert.equal(eraserHitsStroke(curve, point(87.5, 62.5), point(87.5, 62.5), 1), true);
  assert.equal(eraserHitsStroke(curve, point(100, 100), point(100, 100), 1), false);
  assert.equal(freehandPath(curve.points), 'M 0 0 Q 100 100 150 50 L 200 0');
});

test('eraser screen radius stays consistent as canvas zoom changes and includes stroke width', () => {
  for (const zoom of [.15, .5, 1, 2.5]) {
    const line = stroke([point(0, 0), point(1000, 0)], 0);
    assert.equal(eraserHitsStroke(line, point(100, 7 / zoom), point(100, 7 / zoom), zoom), true);
    assert.equal(eraserHitsStroke(line, point(100, 10 / zoom), point(100, 10 / zoom), zoom), false);
  }
  const thick = stroke([point(0, 0), point(1000, 0)], 20);
  assert.equal(eraserHitsStroke(thick, point(100, 17), point(100, 17), 1), true);
  assert.equal(eraserHitsStroke(thick, point(100, 20), point(100, 20), 1), false);
});

test('dots, repeated points and empty strokes have well-defined geometry', () => {
  assert.equal(freehandPath([]), '');
  assert.equal(freehandPath([point(4, 7)]), 'M 4 7 l 0.01 0.01');
  assert.equal(eraserHitsStroke(stroke([point(4, 7)]), point(4, 7), point(4, 7), 1), true);
  assert.equal(eraserHitsStroke(stroke([]), point(0, 0), point(0, 0), 1), false);
  assert.equal(pointSegmentDistance(point(3, 4), point(0, 0), point(0, 0)), 5);
  assert.equal(eraserHitsStroke(stroke([point(0, 0), point(0, 0)]), point(0, 0), point(0, 0), 1), true);
});

test('adaptive curve flattening preserves endpoints without mutating stored samples', () => {
  const points = [point(-100, 0), point(0, 500), point(100, 0), point(200, -50)];
  const original = structuredClone(points);
  const flattened = flattenFreehandStroke(points, .1);
  assert.deepEqual(flattened[0], points[0]);
  assert.deepEqual(flattened.at(-1), points.at(-1));
  assert.ok(flattened.length > points.length);
  assert.deepEqual(points, original);
});

test('sampling uses screen distance and always retains a short final endpoint', () => {
  const points = [point(0, 0)];
  appendFreehandPoint(points, point(.5, 0), 1);
  assert.equal(points.length, 1);
  appendFreehandPoint(points, point(.5, 0), 1, true);
  assert.equal(points.length, 2);
  appendFreehandPoint(points, point(.5, 0), 1, true);
  assert.equal(points.length, 2, 'duplicate coalesced samples are ignored');
  const zoomed = [point(0, 0)];
  appendFreehandPoint(zoomed, point(1, 0), 2.5);
  assert.equal(zoomed.length, 2);
});

test('erasing several strokes commits once, undoes together and stays separate from drawing', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const strokes = doc.getMap('strokes');
  const a = { id: 'a', ...stroke([point(0, 0), point(100, 0)]) };
  const b = { id: 'b', ...stroke([point(0, 50), point(100, 50)]) };
  const untouched = { id: 'c', ...stroke([point(300, 0), point(400, 0)]) };
  for (const item of [a, b, untouched]) strokes.set(item.id, item);
  const undo = new Y.UndoManager(strokes);
  let updates = 0;
  doc.on('update', () => updates++);
  const erased = new Map();
  for (const item of strokes.values()) {
    if (eraserHitsStroke(item, point(50, -100), point(50, 100), 1)) erased.set(item.id, item);
  }
  assert.equal(strokes.size, 3, 'preview and cancellation leave the shared document intact');
  assert.equal(updates, 0);
  undo.stopCapturing();
  doc.transact(() => erased.forEach((original, id) => {
    if (strokes.get(id) === original) strokes.delete(id);
  }));
  undo.stopCapturing();
  assert.equal(updates, 1);
  assert.deepEqual(Array.from(strokes.keys()), ['c']);
  strokes.set('dot', { id: 'dot', ...stroke([point(20, 20)]) });
  undo.stopCapturing();
  undo.undo();
  assert.equal(strokes.has('dot'), false);
  assert.equal(strokes.has('a'), false);
  undo.undo();
  assert.equal(strokes.has('a'), true);
  assert.equal(strokes.has('b'), true);
  assert.equal(strokes.has('c'), true);
  undo.redo();
  assert.equal(strokes.has('a'), false);
  assert.equal(strokes.has('b'), false);
  undo.destroy();
  doc.destroy();
});

test('a concurrent replacement of a previewed stroke survives eraser completion', async () => {
  const Y = await import('yjs');
  const doc = new Y.Doc();
  const strokes = doc.getMap('strokes');
  const original = { id: 'a', ...stroke([point(0, 0), point(100, 0)]) };
  strokes.set('a', original);
  const erased = new Map([['a', original]]);
  const replacement = { ...original, points: [point(500, 500), point(600, 500)] };
  strokes.set('a', replacement);
  doc.transact(() => erased.forEach((snapshot, id) => {
    if (strokes.get(id) === snapshot) strokes.delete(id);
  }));
  assert.deepEqual(strokes.get('a'), replacement);
  doc.destroy();
});
