import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRoomCommand,
  newRoom,
  musicPosition,
  timerRemaining,
  persistentRoom,
  presenceColor,
} from '../packages/shared/src/room.ts';
const owner = {
  userId: 'owner',
  name: 'Owner',
  role: 'OWNER',
  socketId: 'one',
};
const viewer = {
  userId: 'viewer',
  name: 'Viewer',
  role: 'VIEWER',
  socketId: 'two',
};
const run = (state, command, actor = owner, now = 1000) =>
  applyRoomCommand(state, command, actor, now, 'poll-one');
test('shared music and timer use server time and pause/resume without jumping', () => {
  let state = run(newRoom(), { action: 'music-play' });
  assert.equal(musicPosition(state.music, 4500), 3500);
  state = run(state, { action: 'music-pause' }, owner, 4500);
  assert.equal(musicPosition(state.music, 9000), 3500);
  state = run(state, { action: 'music-play' }, owner, 9000);
  assert.equal(musicPosition(state.music, 10000), 4500);
  state = run(state, { action: 'timer-start', durationMs: 6000 }, owner, 10000);
  state = run(state, { action: 'timer-pause' }, owner, 12000);
  assert.equal(timerRemaining(state.timer, 100000), 4000);
  state = run(state, { action: 'timer-resume' }, owner, 100000);
  assert.equal(timerRemaining(state.timer, 101000), 3000);
  assert.equal(timerRemaining(state.timer, 200000), 0);
});
test('a participant has one replaceable vote across tabs; closed/stale votes and readonly controls are rejected', () => {
  let state = run(newRoom(), {
    action: 'poll-create',
    question: 'Ready?',
    options: ['Yes', 'No'],
  });
  state = run(
    state,
    { action: 'poll-vote', pollId: 'poll-one', option: 0 },
    viewer,
  );
  state = run(
    state,
    { action: 'poll-vote', pollId: 'poll-one', option: 1 },
    { ...viewer, socketId: 'three' },
  );
  assert.deepEqual(state.poll.votes, { viewer: 1 });
  for (const action of [
    'music-play',
    'timer-start',
    'poll-create',
    'meeting-url',
    'presentation-claim',
  ])
    assert.throws(() => run(state, { action }, viewer), /владельцу/);
  assert.throws(() =>
    run(state, { action: 'poll-vote', pollId: 'old', option: 0 }, viewer),
  );
  state = run(state, { action: 'poll-close', pollId: 'poll-one' });
  assert.throws(() =>
    run(state, { action: 'poll-vote', pollId: 'poll-one', option: 0 }, viewer),
  );
});
test('presentation ownership, external links and ephemeral call readiness respect boundaries', () => {
  let state = run(newRoom(), { action: 'presentation-claim' });
  const editor = { ...viewer, role: 'EDITOR' };
  assert.throws(() =>
    run(
      state,
      { action: 'presentation-view', camera: { x: 10, y: 20, zoom: 1 } },
      editor,
    ),
  );
  assert.throws(() => run(state, { action: 'presentation-claim' }, editor));
  state = run(state, {
    action: 'presentation-view',
    camera: { x: 10, y: 20, zoom: 1 },
  });
  assert.deepEqual(state.camera, { x: 10, y: 20, zoom: 1 });
  assert.throws(() =>
    run(state, {
      action: 'music-select',
      source: { kind: 'builtin', value: ['calm'] },
    }),
  );
  for (const url of [
    'javascript:alert(1)',
    'http://insecure.example',
    'https://user:password@example.com',
  ]) {
    assert.throws(() => run(state, { action: 'meeting-url', url }));
    assert.throws(() =>
      run(state, {
        action: 'music-select',
        source: { kind: 'url', value: url },
      }),
    );
  }
  state = run(state, { action: 'call-join' }, viewer);
  state = run(state, { action: 'call-hand', raised: true }, viewer);
  assert.equal(state.participants[0].handRaised, true);
  assert.equal(persistentRoom(state).presenter, undefined);
  assert.equal(persistentRoom(state).participants, undefined);
  assert.equal(persistentRoom(state).music.source.value, 'calm');
  assert.equal(newRoom().participants.length, 0);
  assert.equal(presenceColor('user-a'), presenceColor('user-a'));
});
