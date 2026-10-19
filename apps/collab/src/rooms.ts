import { randomUUID } from 'node:crypto';
import type {
  Document,
  onStatelessPayload,
  onDisconnectPayload,
} from '@hocuspocus/server';
import { query } from '@modelboard/db';
import {
  applyRoomCommand,
  newRoom,
  persistentRoom,
  ROOM_REACTIONS,
  type RoomState,
  type RoomActor,
} from '@modelboard/shared';

type Room = {
  state: RoomState;
  loaded: Promise<void>;
  queue: Promise<void>;
  limits: Map<string, number[]>;
};
const rooms = new Map<string, Room>();
async function roomFor(name: string) {
  let room = rooms.get(name);
  if (!room) {
    const entry: Room = {
      state: newRoom(),
      loaded: Promise.resolve(),
      queue: Promise.resolve(),
      limits: new Map(),
    };
    rooms.set(name, entry);
    entry.loaded = query('SELECT state FROM board_sessions WHERE board_id=$1', [
      name.slice(6),
    ])
      .then((result) => {
        if (result.rows[0])
          entry.state = {
            ...newRoom(),
            ...result.rows[0].state,
            presenter: null,
            camera: null,
            participants: [],
          };
      })
      .catch((error) => {
        rooms.delete(name);
        throw error;
      });
    room = entry;
  }
  await room.loaded;
  return room;
}
function snapshot(document: Document, state: RoomState) {
  document.broadcastStateless(
    JSON.stringify({ type: 'room-state', state, serverNow: Date.now() }),
  );
}
function actorOf(connection: onStatelessPayload['connection']): RoomActor {
  const { user, role } = connection.context;
  return {
    userId: user.id,
    name: user.displayName,
    role,
    socketId: connection.socketId,
  };
}
export async function handleRoomMessage({
  documentName,
  document,
  payload,
  connection,
}: onStatelessPayload) {
  if (!documentName.startsWith('board:')) return;
  let message: any;
  try {
    message = JSON.parse(payload);
  } catch {
    return;
  }
  if (message?.type !== 'room-command') return;
  const fail = (error: unknown) =>
    connection.sendStateless(
      JSON.stringify({
        type: 'room-error',
        message: error instanceof Error ? error.message : 'Ошибка сессии',
      }),
    );
  if (payload.length > 12000) {
    fail(new Error('Слишком большая команда сессии'));
    return;
  }
  try {
    const room = await roomFor(documentName);
    const task = room.queue.then(async () => {
      try {
        const actor = actorOf(connection),
          now = Date.now(),
          command = message.command;
        const key = actor.socketId;
        const times = (room.limits.get(key) ?? []).filter(
          (time) => now - time < 1000,
        );
        if (times.length >= 15)
          throw new Error('Слишком много команд. Подождите секунду');
        room.limits.set(key, [...times, now]);
        if (command?.action === 'subscribe') {
          connection.sendStateless(
            JSON.stringify({ type: 'room-hello', socketId: actor.socketId }),
          );
          connection.sendStateless(
            JSON.stringify({
              type: 'room-state',
              state: room.state,
              serverNow: now,
            }),
          );
          return;
        }
        if (command?.action === 'reaction') {
          if (!ROOM_REACTIONS.includes(command.emoji))
            throw new Error('Неизвестная реакция');
          const last = room.limits.get(`reaction:${actor.userId}`)?.[0] ?? 0;
          if (now - last < 1000)
            throw new Error('Реакцию можно отправлять раз в секунду');
          room.limits.set(`reaction:${actor.userId}`, [now]);
          document.broadcastStateless(
            JSON.stringify({
              type: 'room-reaction',
              id: randomUUID(),
              emoji: command.emoji,
              userId: actor.userId,
              name: actor.name,
              at: now,
            }),
          );
          return;
        }
        if (
          command?.action === 'presentation-view' &&
          command.camera?.frameId
        ) {
          const value = document
            .getMap<any>('nodes')
            .get(command.camera.frameId);
          const node = value?.toJSON ? value.toJSON() : value;
          if (node?.type !== 'frame')
            throw new Error('Frame больше не существует');
        }
        const next = applyRoomCommand(
          room.state,
          command,
          actor,
          now,
          randomUUID(),
        );
        if (next === room.state) return;
        if (
          !command.action.startsWith('presentation-') &&
          !command.action.startsWith('call-')
        ) {
          await query(
            `INSERT INTO board_sessions(board_id,state) VALUES($1,$2::jsonb) ON CONFLICT(board_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,
            [documentName.slice(6), JSON.stringify(persistentRoom(next))],
          );
        }
        room.state = next;
        snapshot(document, next);
      } catch (error) {
        fail(error);
      }
    });
    room.queue = task.catch(() => undefined);
    await task;
  } catch (error) {
    fail(error);
  }
}
export async function disconnectRoom({
  documentName,
  document,
  socketId,
}: onDisconnectPayload) {
  const room = rooms.get(documentName);
  if (!room) return;
  await room.loaded;
  const task = room.queue.then(() => {
    room.limits.delete(socketId);
    const state = room.state;
    const participants = state.participants.filter(
      (p) => p.socketId !== socketId,
    );
    if (
      state.presenter?.socketId === socketId ||
      participants.length !== state.participants.length
    ) {
      room.state = {
        ...state,
        revision: state.revision + 1,
        participants,
        ...(state.presenter?.socketId === socketId
          ? { presenter: null, camera: null }
          : {}),
      };
      snapshot(document, room.state);
    }
    if (!document.getConnectionsCount() && rooms.get(documentName) === room)
      rooms.delete(documentName);
  });
  room.queue = task.catch(() => undefined);
  await task;
}
