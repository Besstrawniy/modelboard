import { Disc3, Play, Pause, Volume2, VolumeX, RotateCcw, Link, SkipBack, SkipForward } from 'lucide-react';
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
  const [playlist, setPlaylist] = useState<Array<{title:string;url:string}>>([]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/music/playlist.json',{signal:controller.signal}).then(response=>response.ok?response.json():[]).then(items=>{
      if(Array.isArray(items))setPlaylist(items.filter(item=>typeof item?.title==='string'&&typeof item?.url==='string'&&item.url.startsWith('/music/')).slice(0,1000));
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const trackIndex=playlist.findIndex(track=>track.url===music.source.value);
  const stepTrack=(direction:number)=>{
    if(!playlist.length)return;
    const nextIndex = trackIndex < 0 ? (direction > 0 ? 0 : playlist.length - 1)
      : (trackIndex + direction + playlist.length) % playlist.length;
    const track=playlist[nextIndex];
    send({action:'music-select',source:{kind:'url',value:track.url,title:track.title.slice(0,120)}});
    if(music.playing)send({action:'music-play'});
  };
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
      <div className="music-now-playing"><div className={`music-disc ${music.playing && listening && ready ? 'is-playing' : ''}`}><Disc3 size={54}/></div><div><h4>Общая музыка</h4>
      <p>
        {music.source.title} · {music.playing ? 'играет' : 'пауза'}
      </p></div></div>
      <div className="music-volume">      <button
        title={listening ? 'Выключить у меня' : 'Слушать'} aria-label={listening ? 'Выключить у меня' : 'Слушать'}
        disabled={!ready}
        aria-pressed={listening}
        onClick={() => {
          setError('');
          setListening((v) => !v);
        }}
      >
        {listening ? <VolumeX size={18}/> : <Volume2 size={18}/>}
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
      </div>
      {canControl && (
        <>
          <label>
            Общий трек{' '}
            <select
              aria-label="Общий трек"
              disabled={!ready}
              value={
                music.source.kind === 'builtin' ? music.source.value : trackIndex>=0?music.source.value:'url'
              }
              onChange={(event) => {
                const track=playlist.find(track=>track.url===event.target.value);
                if(track)send({action:'music-select',source:{kind:'url',value:track.url,title:track.title.slice(0,120)}});
                else if (event.target.value !== 'url')
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
              {playlist.length>0 && <optgroup label="Моя музыка">{playlist.map(track=><option key={track.url} value={track.url}>{track.title}</option>)}</optgroup>}
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
            <button disabled={!ready} title="Выбрать ссылку" aria-label="Выбрать ссылку"><Link size={16}/></button>
          </form>
          <div className="room-button-row music-transport">
            <button disabled={!ready||!playlist.length} title="Предыдущий трек" aria-label="Предыдущий трек" onClick={()=>stepTrack(-1)}><SkipBack size={18}/></button>
            <button
              title={music.playing ? 'Пауза для всех' : 'Включить для всех'} aria-label={music.playing ? 'Пауза для всех' : 'Включить для всех'} disabled={!ready}
              onClick={() =>
                send({ action: music.playing ? 'music-pause' : 'music-play' })
              }
            >
              {music.playing ? <Pause size={20}/> : <Play size={20}/>}
            </button>
            <button disabled={!ready||!playlist.length} title="Следующий трек" aria-label="Следующий трек" onClick={()=>stepTrack(1)}><SkipForward size={18}/></button>
            <button
              title="С начала" aria-label="С начала" disabled={!ready}
              onClick={() => send({ action: 'music-restart' })}
            >
              <RotateCcw size={18}/>
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
