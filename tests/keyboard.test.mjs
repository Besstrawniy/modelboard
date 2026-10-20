import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutKey } from '../apps/web/src/lib/keyboard.ts';
test('commands use physical keys across layouts while literal input remains untouched', () => {
  for (const [key,code,want] of [['я','KeyZ','z'],['Я','KeyZ','z'],['р','KeyH','h'],['а','KeyF','f'],['ж','Semicolon','ж'],[')','Digit0','0'],['Escape','Escape','escape']]) {
    assert.equal(shortcutKey({key,code}),want);
  }
  assert.equal(shortcutKey({key:'Z'}),'z');
});
