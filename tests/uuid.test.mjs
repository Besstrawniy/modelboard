import test from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../apps/web/src/lib/uuid.ts';

test('HTTP-compatible IDs use random bytes without requiring randomUUID', () => {
  for (const [fill, expected] of [
    [0, '00000000-0000-4000-8000-000000000000'],
    [255, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ]) {
    const source = { getRandomValues(bytes) { assert.equal(bytes.length, 16); return bytes.fill(fill); } };
    assert.equal(createId(source), expected);
  }
});

test('independent IDs have UUID v4 format and do not collide in a large batch', () => {
  const ids = Array.from({ length: 10000 }, () => createId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
