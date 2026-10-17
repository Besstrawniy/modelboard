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
