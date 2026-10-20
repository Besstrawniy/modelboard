import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveServiceUrls } from '../apps/web/src/lib/serviceUrls.ts';

test('LAN clients use their server address for both API and collaboration', () => {
  assert.deepEqual(resolveServiceUrls('http://192.168.1.50:8080/'), {
    apiUrl: 'http://192.168.1.50:8080/api', collabUrl: 'ws://192.168.1.50:8080/collab',
  });
  assert.deepEqual(resolveServiceUrls('http://board.internal:5173/boards/test'), {
    apiUrl: 'http://board.internal:5173/api', collabUrl: 'ws://board.internal:5173/collab',
  });
});
test('HTTPS pages use encrypted WebSocket on the same domain', () => {
  assert.deepEqual(resolveServiceUrls('https://board.example.org/'), {
    apiUrl: 'https://board.example.org/api', collabUrl: 'wss://board.example.org/collab',
  });
});
test('explicit service overrides and relative paths remain supported', () => {
  assert.deepEqual(resolveServiceUrls('https://board.example.org/', { api:'https://api.example.org/api/',collab:'wss://realtime.example.org/ws' }), {
    apiUrl:'https://api.example.org/api',collabUrl:'wss://realtime.example.org/ws',
  });
  assert.deepEqual(resolveServiceUrls('https://board.example.org/', { api:'/custom-api/',collab:'/custom-ws' }), {
    apiUrl:'https://board.example.org/custom-api',collabUrl:'wss://board.example.org/custom-ws',
  });
  assert.equal(resolveServiceUrls('http://localhost:5173/', { api:'',collab:' ' }).collabUrl,'ws://localhost:5173/collab');
  assert.throws(()=>resolveServiceUrls('https://board.example.org/',{collab:'file:///tmp/socket'}));
});
