import { Users, Music, Timer, Phone, Vote, Presentation, Play, Pause, RotateCcw, Save, Check, Hand, LogOut, Square, ChevronLeft, ChevronRight, UserRound, Radio, Eye, EyeOff, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import {
  roomCanControl,
  timerRemaining,
  ROOM_REACTIONS,
  presenceColor,
} from '@modelboard/shared';
import { useBoardRoom } from '../lib/useBoardRoom';
import { canvasNodeSize } from '../lib/canvasGeometry';
import { RoomMusic } from './RoomMusic';

const tabIcons={music:Music,timer:Timer,poll:Vote,presentation:Presentation,call:Phone};
const tabs = {
  music: 'Музыка',
  timer: 'Таймер',
  poll: 'Голосование',
  presentation: 'Показ',
  call: 'Созвон',
};
export function SessionTools({
  provider,
  connected,
  role,
  userId,
  nodes,
  rf,
}: {
  provider: HocuspocusProvider | null;
  connected: boolean;
  role: string;
  userId: string;
  nodes: Node[];
  rf: ReactFlowInstance | null;
}) {
  const { state, ready, socketId, error, offset, reactions, send } =
    useBoardRoom(provider, connected);
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<keyof typeof tabs>('music'),
    [now, setNow] = useState(Date.now()),
    [minutes, setMinutes] = useState('5'),
    [question, setQuestion] = useState(''),
    [options, setOptions] = useState('Да\nНет'),
    [meetingUrl, setMeetingUrl] = useState(''),
    [following, setFollowing] = useState(false);
  const frameRef = useRef<string | undefined>(undefined),
    lastSent = useRef(''),
    lastFollowed = useRef('');
  const canControl = roomCanControl({ role }),
    isPresenter = !!socketId && state.presenter?.socketId === socketId;
  const frames = nodes
    .filter((node) => node.type === 'frame')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const remaining = timerRemaining(state.timer, now + offset),
    seconds = Math.ceil(remaining / 1000);
  const timerText = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const self = state.participants.find((p) => p.socketId === socketId);
  const people = [
    ...new Map(
      state.participants.map((p) => [
        p.userId,
        {
          ...p,
          handRaised: state.participants.some(
            (other) => other.userId === p.userId && other.handRaised,
          ),
        },
      ]),
    ).values(),
  ];
  useEffect(() => {
    if (state.timer.endsAt === null) return;
    setNow(Date.now());
    if (state.timer.endsAt <= Date.now() + offset) return;
    const end = state.timer.endsAt;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current + offset >= end) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [state.timer.endsAt, offset]);
  useEffect(() => setMeetingUrl(state.meetingUrl), [state.meetingUrl]);
  useEffect(() => {
    if (
      frameRef.current &&
      !nodes.some(
        (node) => node.id === frameRef.current && node.type === 'frame',
      )
    )
      frameRef.current = undefined;
  }, [nodes]);
  const stopFollowing = useCallback(() => {
    setFollowing(false);
    lastFollowed.current = '';
    // Interrupt an in-flight camera transition, including one received just before the click.
    if (rf) void rf.setViewport(rf.getViewport(), { duration: 0 });
  }, [rf]);
  const camera = () => {
    if (!rf) return null;
    const bounds = document
      .querySelector('.react-flow')
      ?.getBoundingClientRect();
    if (!bounds) return null;
    const center = rf.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    return {
      ...center,
      zoom: rf.getZoom(),
      ...(frameRef.current ? { frameId: frameRef.current } : {}),
    };
  };
  useEffect(() => {
    lastSent.current = '';
    frameRef.current = undefined;
    if (!isPresenter || !ready || !rf) return;
    const publish = () => {
      const view = camera();
      if (!view) return;
      const key = JSON.stringify(view);
      if (key === lastSent.current) return;
      lastSent.current = key;
      send({ action: 'presentation-view', camera: view });
    };
    publish();
    const timer = setInterval(publish, 500);
    return () => clearInterval(timer);
  }, [isPresenter, ready, rf, send]);
  useEffect(() => {
    if (!state.presenter || isPresenter || !ready) {
      if (following) stopFollowing();
      lastFollowed.current = '';
      return;
    }
    if (!following || !rf || !state.camera) return;
    const key = JSON.stringify(state.camera);
    if (key === lastFollowed.current) return;
    lastFollowed.current = key;
    void rf.setCenter(state.camera.x, state.camera.y, {
      zoom: state.camera.zoom,
      duration: 180,
    });
  }, [
    state.presenter,
    state.camera,
    isPresenter,
    following,
    rf,
    ready,
    stopFollowing,
  ]);
  useEffect(() => {
    if (!following) return;
    window.addEventListener('modelboard:manual-navigation', stopFollowing);
    return () =>
      window.removeEventListener('modelboard:manual-navigation', stopFollowing);
  }, [following, stopFollowing]);
  const showFrame = async (frame: Node) => {
    if (!rf || !isPresenter || !ready) return;
    frameRef.current = frame.id;
    const size = {
      width: canvasNodeSize(frame, 'width', 520),
      height: canvasNodeSize(frame, 'height', 320),
    };
    await rf.fitBounds(
      { ...frame.position, ...size },
      { padding: 0.12, duration: 180 },
    );
    const view = camera();
    if (view) send({ action: 'presentation-view', camera: view });
  };
  const frameIndex = frames.findIndex(
    (frame) => frame.id === state.camera?.frameId,
  );
  return (
    <>
      <button
        className="session-trigger"
        title="Совместная работа"
        aria-label="Совместная работа"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Users size={17}/>
        {state.timer.endsAt !== null && (
          <span className="session-timer-badge">{timerText}</span>
        )}
      </button>
      {(['music','timer','call'] as const).map(id=>{const Icon=tabIcons[id];return <button key={id} className="session-trigger" title={`Открыть: ${tabs[id]}`} aria-label={`Открыть: ${tabs[id]}`} onClick={()=>{setTab(id);setOpen(true);}}><Icon size={17}/></button>;})}
      {createPortal(
        <>
          <aside
            className="session-panel"
            aria-label="Инструменты совместной работы"
            hidden={!open}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Совместная работа</h3>
              <button
                className="icon-button"
                aria-label="Закрыть совместную работу"
                onClick={() => setOpen(false)}
              >
                <X size={18}/>
              </button>
            </header>
            <nav aria-label="Разделы совместной работы">
              {Object.entries(tabs).map(([id, title]) => (
                <button
                  key={id}
                  title={title} aria-label={title} aria-pressed={tab === id}
                  onClick={() => setTab(id as keyof typeof tabs)}
                >
                  {(() => { const Icon=tabIcons[id as keyof typeof tabIcons]; return <Icon size={18}/>; })()}
                </button>
              ))}
            </nav>
            <div className="session-panel__body">
              {!ready && (
                <p role="status">
                  Подключение к сессии… Управление временно недоступно.
                </p>
              )}
              <RoomMusic
                music={state.music}
                offset={offset}
                ready={ready}
                canControl={canControl}
                send={send}
                visible={tab === 'music'}
              />
              {tab === 'timer' && (
                <section>
                  <h4>Общий таймер</h4>
                  <output className="room-timer" aria-label="Общий таймер">
                    {timerText}
                  </output>
                  <p role="status">
                    {remaining === 0
                      ? 'Время вышло'
                      : state.timer.endsAt === null
                        ? 'Остановлен'
                        : 'Идёт отсчёт'}
                  </p>
                  {canControl && (
                    <>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          send({
                            action: 'timer-start',
                            durationMs: Number(minutes) * 60000,
                          });
                        }}
                      >
                        <label>
                          Минуты{' '}
                          <input
                            aria-label="Длительность таймера в минутах"
                            type="number"
                            min=".1"
                            max="240"
                            step=".1"
                            value={minutes}
                            onChange={(event) => setMinutes(event.target.value)}
                            required
                          />
                        </label>
                        <button disabled={!ready} title="Запустить таймер" aria-label="Запустить таймер"><Play size={17}/></button>
                      </form>
                      <div className="room-button-row">
                        <button
                          title={state.timer.endsAt === null ? 'Продолжить таймер' : 'Пауза таймера'} aria-label={state.timer.endsAt === null ? 'Продолжить таймер' : 'Пауза таймера'} disabled={!ready || remaining === 0}
                          onClick={() =>
                            send({
                              action:
                                state.timer.endsAt === null
                                  ? 'timer-resume'
                                  : 'timer-pause',
                            })
                          }
                        >
                          {state.timer.endsAt === null ? <Play size={17}/> : <Pause size={17}/>}
                        </button>
                        <button
                          disabled={!ready}
                          onClick={() => send({ action: 'timer-reset' })}
                         title="Сбросить таймер" aria-label="Сбросить таймер"><RotateCcw size={17}/></button>
                      </div>
                    </>
                  )}
                </section>
              )}
              {tab === 'poll' && (
                <section>
                  <h4>Голосование</h4>
                  {state.poll ? (
                    <>
                      <h5>{state.poll.question}</h5>
                      <p>
                        {state.poll.closed
                          ? 'Завершено'
                          : 'Один голос на участника; выбор можно изменить.'}
                      </p>
                      {state.poll.options.map((option, index) => {
                        const count = Object.values(state.poll!.votes).filter(
                          (value) => value === index,
                        ).length;
                        return (
                          <div className="room-poll-option" key={index}>
                            <button
                              disabled={!ready || state.poll!.closed}
                              aria-pressed={state.poll!.votes[userId] === index}
                              onClick={() =>
                                send({
                                  action: 'poll-vote',
                                  pollId: state.poll!.id,
                                  option: index,
                                })
                              }
                            >
                              {option}
                            </button>
                            <span aria-label={`Голосов за ${option}`}>
                              {count}
                            </span>
                          </div>
                        );
                      })}
                      <p>
                        Проголосовали: {Object.keys(state.poll.votes).length}
                      </p>
                      {canControl && !state.poll.closed && (
                        <button
                          disabled={!ready}
                          onClick={() =>
                            send({
                              action: 'poll-close',
                              pollId: state.poll!.id,
                            })
                          }
                         title="Завершить голосование" aria-label="Завершить голосование"><Square size={17}/></button>
                      )}
                    </>
                  ) : (
                    <p>Активного голосования нет.</p>
                  )}
                  {canControl && (!state.poll || state.poll.closed) && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        send({
                          action: 'poll-create',
                          question,
                          options: options
                            .split('\n')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        });
                      }}
                    >
                      <label>
                        Вопрос{' '}
                        <input
                          aria-label="Вопрос голосования"
                          maxLength={200}
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Варианты, каждый с новой строки{' '}
                        <textarea
                          aria-label="Варианты голосования"
                          rows={4}
                          value={options}
                          onChange={(event) => setOptions(event.target.value)}
                          required
                        />
                      </label>
                      <small>
                        От 2 до 6 разных вариантов. Результат виден всем.
                      </small>
                      <button disabled={!ready} title="Начать голосование" aria-label="Начать голосование"><Vote size={17}/></button>
                    </form>
                  )}
                </section>
              )}
              {tab === 'presentation' && (
                <section>
                  <h4>Ведущий и презентация</h4>
                  <p>
                    {state.presenter
                      ? `Ведущий: ${state.presenter.name}`
                      : 'Ведущий пока не выбран.'}
                  </p>
                  {canControl && !state.presenter && (
                    <button
                      disabled={!ready}
                      onClick={() => send({ action: 'presentation-claim' })}
                     title="Стать ведущим" aria-label="Стать ведущим"><Presentation size={17}/></button>
                  )}
                  {role === 'OWNER' && state.presenter && !isPresenter && (
                    <button
                      disabled={!ready}
                      onClick={() =>
                        send({ action: 'presentation-claim', takeover: true })
                      }
                     title="Взять управление показом" aria-label="Взять управление показом"><UserRound size={17}/></button>
                  )}
                  {state.presenter && !isPresenter && (
                    <button
                      disabled={!ready}
                      title={following?'Перестать следовать':'Следовать за ведущим'} aria-label={following?'Перестать следовать':'Следовать за ведущим'} aria-pressed={following}
                      onClick={() => {
                        if (following) {
                          stopFollowing();
                          return;
                        }
                        lastFollowed.current = '';
                        setFollowing(true);
                      }}
                    >
                      {following?<EyeOff size={17}/>:<Eye size={17}/>}
                    </button>
                  )}
                  {following && (
                    <p>
                      Показ синхронизирован. Переместите доску вручную или
                      нажмите «Перестать следовать», чтобы выйти.
                    </p>
                  )}
                  {(isPresenter || role === 'OWNER') && state.presenter && (
                    <button
                      disabled={!ready}
                      onClick={() => send({ action: 'presentation-stop' })}
                     title="Завершить показ" aria-label="Завершить показ"><Square size={17}/></button>
                  )}
                  {isPresenter && (
                    <>
                      <p>
                        Участники подключаются к показу по желанию. Перемещайте
                        доску или выберите Frame.
                      </p>
                      <div className="room-button-row">
                        <button
                          disabled={frameIndex <= 0}
                          onClick={() => void showFrame(frames[frameIndex - 1])}
                         title="Предыдущий Frame" aria-label="Предыдущий Frame"><ChevronLeft size={17}/></button>
                        <button
                          disabled={
                            !frames.length || frameIndex >= frames.length - 1
                          }
                          onClick={() => void showFrame(frames[frameIndex + 1])}
                         title="Следующий Frame" aria-label="Следующий Frame"><ChevronRight size={17}/></button>
                      </div>
                      {frames.map((frame, index) => (
                        <button
                          className="room-frame"
                          key={frame.id}
                          aria-pressed={frame.id === state.camera?.frameId}
                          onClick={() => void showFrame(frame)}
                        >
                          {index + 1}. {String(frame.data.title ?? 'Frame')}
                        </button>
                      ))}
                      {!frames.length && (
                        <p>
                          Добавьте Frame на доску, чтобы собрать презентацию.
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}
              {tab === 'call' && (
                <section>
                  <h4>Комната созвона</h4>
                  <p>
                    Соберите участников здесь и откройте общую ссылку. Звук и
                    видео проходят во внешнем сервисе; эта доска их пока не
                    передаёт.
                  </p>
                  {canControl && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        send({ action: 'meeting-url', url: meetingUrl.trim() });
                      }}
                    >
                      <label>
                        Ссылка на созвон{' '}
                        <input
                          type="url"
                          aria-label="Ссылка на созвон"
                          maxLength={2000}
                          value={meetingUrl}
                          onChange={(event) =>
                            setMeetingUrl(event.target.value)
                          }
                          placeholder="https://…"
                        />
                      </label>
                      <button disabled={!ready} title="Сохранить ссылку" aria-label="Сохранить ссылку"><Save size={17}/></button>
                    </form>
                  )}
                  {state.meetingUrl && (
                    <a
                      className="room-call-link"
                      href={state.meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть созвон ↗
                    </a>
                  )}
                  <div className="room-button-row">
                    <button title={self?'Выйти из комнаты':'Готов к созвону'} aria-label={self?'Выйти из комнаты':'Готов к созвону'}
                      disabled={!ready}
                      onClick={() =>
                        send({ action: self ? 'call-leave' : 'call-join' })
                      }
                    >
                      {self ? <LogOut size={17}/> : <Phone size={17}/>}
                    </button>
                    {self && (
                      <button
                        disabled={!ready}
                        title={self.handRaised?'Опустить руку':'Поднять руку'} aria-label={self.handRaised?'Опустить руку':'Поднять руку'} aria-pressed={self.handRaised}
                        onClick={() =>
                          send({
                            action: 'call-hand',
                            raised: !self.handRaised,
                          })
                        }
                      >
                        <Hand size={17}/>
                      </button>
                    )}
                  </div>
                  <p>Готовы: {people.length}</p>
                  <ul className="room-participants">
                    {people.map((person) => (
                      <li key={person.userId}>
                        <span style={{ color: presenceColor(person.userId) }}>
                          ●
                        </span>{' '}
                        {person.name}
                        {person.handRaised ? ' · ✋ поднята рука' : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {error && (
                <p role="alert" className="inspector-error">
                  {error}
                </p>
              )}
            </div>
            <footer>
              <span>Реакция</span>
              <div className="room-reactions">
                {ROOM_REACTIONS.map((emoji) => (
                  <button
                    disabled={!ready}
                    aria-label={`Реакция ${emoji}`}
                    key={emoji}
                    onClick={() => send({ action: 'reaction', emoji })}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </footer>
          </aside>
          <div className="room-reaction-feed" aria-live="polite">
            {reactions.map((reaction) => (
              <div className="room-reaction" key={reaction.id}>
                <span>{reaction.emoji}</span>
                <strong>{reaction.name}</strong>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
