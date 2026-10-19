export type RoomActor = {
  userId: string;
  name: string;
  role: string;
  socketId: string;
};
export type MusicSource = {
  kind: 'builtin' | 'url';
  value: string;
  title: string;
};
export type RoomCamera = {
  x: number;
  y: number;
  zoom: number;
  frameId?: string;
};
export type RoomState = {
  revision: number;
  music: {
    source: MusicSource;
    playing: boolean;
    positionMs: number;
    anchor: number;
  };
  timer: { durationMs: number; remainingMs: number; endsAt: number | null };
  poll: null | {
    id: string;
    question: string;
    options: string[];
    votes: Record<string, number>;
    closed: boolean;
  };
  meetingUrl: string;
  presenter: null | RoomActor;
  camera: RoomCamera | null;
  participants: Array<RoomActor & { handRaised: boolean }>;
};
export const ROOM_REACTIONS = ['👍', '❤️', '🎉', '👏', '🤔', '🙋'] as const;
export const ROOM_TRACKS = {
  calm: 'Спокойствие',
  focus: 'Фокус',
  rain: 'Дождь',
} as const;
export function newRoom(): RoomState {
  return {
    revision: 0,
    music: {
      source: { kind: 'builtin', value: 'calm', title: 'Спокойствие' },
      playing: false,
      positionMs: 0,
      anchor: 0,
    },
    timer: { durationMs: 300000, remainingMs: 300000, endsAt: null },
    poll: null,
    meetingUrl: '',
    presenter: null,
    camera: null,
    participants: [],
  };
}
export function musicPosition(music: RoomState['music'], now: number) {
  return Math.max(
    0,
    music.positionMs + (music.playing ? now - music.anchor : 0),
  );
}
export function timerRemaining(timer: RoomState['timer'], now: number) {
  return Math.min(
    timer.durationMs,
    Math.max(0, timer.endsAt === null ? timer.remainingMs : timer.endsAt - now),
  );
}
export function roomUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000)
    throw new Error('Некорректная ссылка');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Укажите HTTPS-ссылку без логина и пароля');
  return url.href;
}
/** Only a single audio filename inside the deliberately public music folder. */
export function roomMusicUrl(value: unknown) {
  if (typeof value === 'string' && value.startsWith('/music/')) {
    let filename: string;
    try { filename = decodeURIComponent(value.slice(7)); } catch { throw new Error('Некорректное имя трека'); }
    if (!filename || filename.startsWith('.') || /[\\/\x00-\x1f?#]/.test(filename) || !/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(filename)) throw new Error('Некорректное имя трека');
    return `/music/${encodeURIComponent(filename)}`;
  }
  return roomUrl(value);
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error(`Текст: от 1 до ${max} символов`);
  return value.trim();
}
function number(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error('Недопустимое числовое значение');
  return value;
}
export function roomCanControl(actor: Pick<RoomActor, 'role'>) {
  return ['OWNER', 'EDITOR'].includes(actor.role);
}
/** The server supplies the actor and time; neither is accepted from the client payload. */
export function applyRoomCommand(
  previous: RoomState,
  command: any,
  actor: RoomActor,
  now: number,
  id: string,
): RoomState {
  if (!command || typeof command.action !== 'string')
    throw new Error('Неизвестная команда сессии');
  const participantAction = [
    'poll-vote',
    'call-join',
    'call-leave',
    'call-hand',
  ].includes(command.action);
  if (!participantAction && !roomCanControl(actor))
    throw new Error('Управление доступно владельцу и редакторам');
  const state = structuredClone(previous);
  switch (command.action) {
    case 'music-select': {
      const source = command.source;
      if (
        source?.kind === 'builtin' &&
        typeof source.value === 'string' &&
        Object.hasOwn(ROOM_TRACKS, source.value)
      )
        state.music = {
          source: {
            kind: 'builtin',
            value: source.value,
            title: ROOM_TRACKS[source.value as keyof typeof ROOM_TRACKS],
          },
          playing: false,
          positionMs: 0,
          anchor: now,
        };
      else if (source?.kind === 'url')
        state.music = {
          source: {
            kind: 'url',
            value: roomMusicUrl(source.value),
            title: text(source.title || 'Общий трек', 120),
          },
          playing: false,
          positionMs: 0,
          anchor: now,
        };
      else throw new Error('Неизвестный источник музыки');
      break;
    }
    case 'music-play':
      state.music.anchor = now;
      if (!previous.music.playing) state.music.playing = true;
      else return previous;
      break;
    case 'music-pause':
      state.music.positionMs = musicPosition(state.music, now);
      state.music.anchor = now;
      state.music.playing = false;
      break;
    case 'music-restart':
      state.music.positionMs = 0;
      state.music.anchor = now;
      break;
    case 'timer-start': {
      const duration = number(command.durationMs, 5000, 4 * 60 * 60 * 1000);
      state.timer = {
        durationMs: duration,
        remainingMs: duration,
        endsAt: now + duration,
      };
      break;
    }
    case 'timer-pause':
      state.timer.remainingMs = timerRemaining(state.timer, now);
      state.timer.endsAt = null;
      break;
    case 'timer-resume': {
      const remaining = timerRemaining(state.timer, now);
      if (!remaining) throw new Error('Таймер завершён');
      state.timer.endsAt = now + remaining;
      break;
    }
    case 'timer-reset':
      state.timer.endsAt = null;
      state.timer.remainingMs = state.timer.durationMs;
      break;
    case 'poll-create': {
      if (state.poll && !state.poll.closed)
        throw new Error('Сначала завершите текущее голосование');
      if (
        !Array.isArray(command.options) ||
        command.options.length < 2 ||
        command.options.length > 6
      )
        throw new Error('Нужно от 2 до 6 вариантов');
      const options = command.options.map((v: unknown) => text(v, 80));
      if (new Set(options).size !== options.length)
        throw new Error('Варианты должны различаться');
      state.poll = {
        id,
        question: text(command.question, 200),
        options,
        votes: {},
        closed: false,
      };
      break;
    }
    case 'poll-vote': {
      if (!state.poll || state.poll.id !== command.pollId || state.poll.closed)
        throw new Error('Голосование уже завершено или заменено');
      const option = number(command.option, 0, state.poll.options.length - 1);
      if (!Number.isInteger(option)) throw new Error('Неизвестный вариант');
      state.poll.votes[actor.userId] = option;
      break;
    }
    case 'poll-close':
      if (!state.poll || state.poll.id !== command.pollId)
        throw new Error('Не найдено голосование');
      state.poll.closed = true;
      break;
    case 'meeting-url':
      state.meetingUrl = command.url === '' ? '' : roomUrl(command.url);
      break;
    case 'call-join':
      if (!state.participants.some((p) => p.socketId === actor.socketId)) {
        if (state.participants.length >= 50)
          throw new Error('В комнате уже 50 подключений');
        state.participants.push({ ...actor, handRaised: false });
      }
      break;
    case 'call-leave':
      state.participants = state.participants.filter(
        (p) => p.socketId !== actor.socketId,
      );
      break;
    case 'call-hand': {
      const person = state.participants.find(
        (p) => p.socketId === actor.socketId,
      );
      if (!person) throw new Error('Сначала отметьте готовность к созвону');
      person.handRaised = command.raised === true;
      break;
    }
    case 'presentation-claim':
      if (
        state.presenter &&
        state.presenter.socketId !== actor.socketId &&
        !(actor.role === 'OWNER' && command.takeover === true)
      )
        throw new Error('Ведущий уже выбран');
      state.presenter = actor;
      state.camera = null;
      break;
    case 'presentation-stop':
      if (
        state.presenter?.socketId !== actor.socketId &&
        actor.role !== 'OWNER'
      )
        throw new Error('Остановить показ может ведущий или владелец');
      state.presenter = null;
      state.camera = null;
      break;
    case 'presentation-view':
      if (state.presenter?.socketId !== actor.socketId)
        throw new Error('Показом управляет ведущий');
      state.camera = {
        x: number(command.camera?.x, -1e7, 1e7),
        y: number(command.camera?.y, -1e7, 1e7),
        zoom: number(command.camera?.zoom, 0.15, 2.5),
        ...(command.camera?.frameId
          ? { frameId: text(command.camera.frameId, 250) }
          : {}),
      };
      break;
    default:
      throw new Error('Неизвестная команда сессии');
  }
  state.revision++;
  return state;
}
export function persistentRoom(state: RoomState) {
  const { music, timer, poll, meetingUrl, revision } = state;
  return { music, timer, poll, meetingUrl, revision };
}
export function presenceColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ['#b42318', '#6941c6', '#026aa2', '#027a48', '#b54708', '#c11574'][
    Math.abs(hash) % 6
  ];
}
