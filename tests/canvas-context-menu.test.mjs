import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasContextItems, selectCanvasContextTarget, canvasPasteOffset, clampCanvasMenuPosition,
} from '../apps/web/src/lib/canvasContextMenu.ts';

const options = { readOnly: false, selectionCount: 3, canPaste: true, canUndo: true, canRedo: false, busy: false };
const items = (overrides, page) => canvasContextItems({ ...options, ...overrides }, page).flat();

test('right-click preserves a selected group, changes selection for another object, and ignores deleted targets', () => {
  const nodes = [{ id: 'a', selected: true }, { id: 'b', selected: true }, { id: 'c', selected: false }];
  assert.equal(selectCanvasContextTarget(nodes, 'a'), nodes);
  const changed = selectCanvasContextTarget(nodes, 'c');
  assert.deepEqual(changed.filter((node) => node.selected).map((node) => node.id), ['c']);
  assert.equal(selectCanvasContextTarget(nodes, 'deleted'), nodes);
  assert.deepEqual(nodes.filter((node) => node.selected).map((node) => node.id), ['a', 'b']);
});

test('paste anchors the group top-left to the flow position and preserves object spacing', () => {
  const nodes = [{ position: { x: -80, y: 20 } }, { position: { x: 40, y: -30 } }];
  const target = { x: 600, y: 250 };
  const delta = canvasPasteOffset(nodes, target);
  const positions = nodes.map((node) => ({ x: node.position.x + delta.x, y: node.position.y + delta.y }));
  assert.equal(Math.min(...positions.map((point) => point.x)), target.x);
  assert.equal(Math.min(...positions.map((point) => point.y)), target.y);
  assert.equal(positions[1].x - positions[0].x, 120);
  assert.equal(positions[1].y - positions[0].y, -50);
  assert.deepEqual(canvasPasteOffset([], target), { x: 0, y: 0 });
});

test('menu stays inside the viewport at each edge', () => {
  const menu = { width: 310, height: 400 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(clampCanvasMenuPosition({ x: 1199, y: 799 }, menu, viewport), { x: 882, y: 392 });
  assert.deepEqual(clampCanvasMenuPosition({ x: -5, y: -10 }, menu, viewport), { x: 8, y: 8 });
  assert.deepEqual(clampCanvasMenuPosition({ x: 100, y: 100 }, menu, viewport), { x: 100, y: 100 });
});

test('read-only participants only get copy and navigation; editing submenus are unavailable', () => {
  assert.deepEqual(items({ readOnly: true }).map((item) => item.command), ['copy', 'fit-selection', 'fit-board']);
  assert.deepEqual(items({ readOnly: true, selectionCount: 0 }).map((item) => item.command), ['fit-board']);
  assert.deepEqual(items({ readOnly: true }, 'align'), []);
  assert.deepEqual(items({ readOnly: true }, 'layers'), []);
});

test('empty-pane menus do not expose object actions; clipboard and history availability are respected', () => {
  const pane = items({ selectionCount: 0, canPaste: false });
  assert.deepEqual(pane.map((item) => item.command), ['paste', 'fit-board', 'undo', 'redo']);
  assert.equal(pane.find((item) => item.command === 'paste').disabled, true);
  assert.equal(pane.find((item) => item.command === 'undo').disabled, false);
  assert.equal(pane.find((item) => item.command === 'redo').disabled, true);
});

test('alignment needs two objects, spacing needs three; moving/resizing disables writes', () => {
  assert.equal(items({ selectionCount: 1 }).find((item) => item.command === 'align-menu').disabled, true);
  const align = items({ selectionCount: 2 }, 'align');
  assert.equal(align.filter((item) => item.command.startsWith('align:')).every((item) => !item.disabled), true);
  assert.equal(align.filter((item) => item.command.startsWith('distribute:')).every((item) => item.disabled), true);
  assert.equal(items({}, 'align').filter((item) => item.command.startsWith('distribute:')).every((item) => !item.disabled), true);
  for (const page of ['main', 'align', 'layers']) {
    for (const item of items({ busy: true }, page)) {
      if (!['back', 'fit-board', 'fit-selection'].includes(item.command)) assert.equal(item.disabled, true, item.command);
    }
  }
});
