import { useCallback, useEffect, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { newRoom, type RoomState } from '@modelboard/shared';
export type RoomReaction = {
  id: string;
  emoji: string;
  userId: string;
  name: string;
  at: number;
};
export function useBoardRoom(
  provider: HocuspocusProvider | null,
  connected: boolean,
) {
  const [state, setState] = useState<RoomState>(newRoom),
    [ready, setReady] = useState(false),
    [socketId, setSocketId] = useState(''),
    [error, setError] = useState(''),
    [offset, setOffset] = useState(0),
    [reactions, setReactions] = useState<RoomReaction[]>([]);
  useEffect(() => {
    setReady(false);
    setSocketId('');
    setReactions([]);
    setError('');
    if (!provider || !connected) return;
    const receive = ({ payload }: { payload: string }) => {
      let message: any;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
      if (message.type === 'room-state') {
        setState(message.state);
        setOffset(message.serverNow - Date.now());
        setReady(true);
      }
      if (message.type === 'room-hello') setSocketId(message.socketId);
      if (message.type === 'room-error') setError(message.message);
      if (message.type === 'room-reaction')
        setReactions((current) => [
          ...current.slice(-7),
          { ...message, at: Date.now() },
        ]);
    };
    const subscribe = () => {
      if (provider.isSynced)
        provider.sendStateless(
          JSON.stringify({
            type: 'room-command',
            command: { action: 'subscribe' },
          }),
        );
    };
    provider.on('stateless', receive);
    provider.on('synced', subscribe);
    subscribe();
    const clock = setInterval(subscribe, 20000);
    const expiry = setInterval(
      () =>
        setReactions((current) =>
          current.some((r) => Date.now() - r.at > 4500)
            ? current.filter((r) => Date.now() - r.at <= 4500)
            : current,
        ),
      1000,
    );
    return () => {
      clearInterval(clock);
      clearInterval(expiry);
      provider.off('stateless', receive);
      provider.off('synced', subscribe);
    };
  }, [provider, connected]);
  const send = useCallback(
    (command: Record<string, unknown>) => {
      if (!provider || !connected || !ready) {
        setError('Дождитесь подключения к сессии');
        return;
      }
      setError('');
      provider.sendStateless(JSON.stringify({ type: 'room-command', command }));
    },
    [provider, connected, ready],
  );
  return {
    state,
    ready: ready && connected,
    socketId,
    error,
    offset,
    reactions,
    send,
  };
}
