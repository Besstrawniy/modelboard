import { useEffect, useRef, useState } from 'react';
import { musicPosition, ROOM_TRACKS, type RoomState } from '@modelboard/shared';
import { ambientMusic } from '../lib/ambientMusic';
export function RoomMusic({
  music,
  offset,
  ready,
  canControl,
  send,
  visible,
}: {
  music: RoomState['music'];
  offset: number;
  ready: boolean;
  canControl: boolean;
  visible: boolean;
  send: (command: Record<string, unknown>) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    latest = useRef({ music, offset, ready });
  latest.current = { music, offset, ready };
  const [listening, setListening] = useState(false),
    [error, setError] = useState(''),
    [volume, setVolume] = useState(() =>
      Math.min(
        1,
        Math.max(
          0,
          Number(localStorage.getItem('modelboard:music-volume') ?? '.3') || 0,
        ),
      ),
    ),
    [url, setUrl] = useState('');
  useEffect(() => {
    const player = audio.current!;
    if (!listening) return;
    const localUrl =
      music.source.kind === 'builtin'
        ? URL.createObjectURL(ambientMusic(music.source.value))
        : '';
    player.src = localUrl || music.source.value;
    setError('');
    return () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [music.source.kind, music.source.value, listening]);
  useEffect(() => {
    audio.current!.volume = volume;
    localStorage.setItem('modelboard:music-volume', String(volume));
  }, [volume]);
  useEffect(() => {
    const player = audio.current!;
    if (!listening || !ready) {
      player.pause();
      return;
    }
    let active = true;
    const sync = () => {
      const current = latest.current;
      if (!listening || !current.ready || !current.music.playing) {
        player.pause();
        return;
      }
      if (Number.isFinite(player.duration) && player.duration > 0) {
        const target =
          (musicPosition(current.music, Date.now() + current.offset) / 1000) %
          player.duration;
        if (Math.abs(player.currentTime - target) > 0.8)
          player.currentTime = target;
      }
      if (player.paused)
        void player.play().catch(() => {
          if (!active) return;
          setError(
            'Нажмите «Слушать» ещё раз. Проверьте доступность аудиофайла.',
          );
          setListening(false);
        });
    };
    const failed = () =>
      setError(
        'Не удалось загрузить трек. Для ссылки нужен прямой HTTPS-адрес аудиофайла.',
      );
    sync();
    const timer = setInterval(sync, 2000);
    player.addEventListener('loadedmetadata', sync);
    player.addEventListener('error', failed);
    return () => {
      active = false;
      clearInterval(timer);
      player.removeEventListener('loadedmetadata', sync);
      player.removeEventListener('error', failed);
    };
  }, [listening, ready, music, offset]);
  return (
    <div className="room-music" hidden={!visible}>
      <audio ref={audio} loop preload="metadata" data-testid="room-audio" />
      <h4>Общая музыка</h4>
      <p>
        {music.source.title} · {music.playing ? 'играет' : 'пауза'}
      </p>
      <button
        disabled={!ready}
        aria-pressed={listening}
        onClick={() => {
          setError('');
          setListening((v) => !v);
        }}
      >
        {listening ? 'Выключить у меня' : 'Слушать'}
      </button>
      <label>
        Моя громкость{' '}
        <input
          aria-label="Моя громкость"
          type="range"
          min="0"
          max="1"
          step=".05"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </label>
      {canControl && (
        <>
          <label>
            Общий трек{' '}
            <select
              aria-label="Общий трек"
              disabled={!ready}
              value={
                music.source.kind === 'builtin' ? music.source.value : 'url'
              }
              onChange={(event) => {
                if (event.target.value !== 'url')
                  send({
                    action: 'music-select',
                    source: { kind: 'builtin', value: event.target.value },
                  });
              }}
            >
              {Object.entries(ROOM_TRACKS).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
              <option value="url" disabled>
                По ссылке (поле ниже)
              </option>
            </select>
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send({
                action: 'music-select',
                source: { kind: 'url', value: url, title: 'Трек по ссылке' },
              });
            }}
          >
            <input
              aria-label="Ссылка на аудиофайл"
              type="url"
              placeholder="https://…/track.mp3"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              maxLength={2000}
            />
            <button disabled={!ready}>Выбрать ссылку</button>
          </form>
          <div className="room-button-row">
            <button
              disabled={!ready}
              onClick={() =>
                send({ action: music.playing ? 'music-pause' : 'music-play' })
              }
            >
              {music.playing ? 'Пауза для всех' : 'Включить для всех'}
            </button>
            <button
              disabled={!ready}
              onClick={() => send({ action: 'music-restart' })}
            >
              С начала
            </button>
          </div>
        </>
      )}
      <small>
        Прослушивание включается лично. Ссылки YouTube/Spotify не являются
        аудиофайлами.
      </small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
