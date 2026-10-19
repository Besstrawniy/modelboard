export type CanvasPresenceState = {
  user?: { id: string; name: string; role: string };
  cursor?: { x: number; y: number } | null;
};
export type CanvasPresence = Array<[number, CanvasPresenceState]>;

/** Hocuspocus emits an array with explicit clientId, not a Map. Keep local
 * pointer traffic and cloned-but-unchanged remote states out of React updates. */
export function reconcileCanvasPresence(
  current: CanvasPresence,
  states: Array<CanvasPresenceState & { clientId: number }>,
  localClientId: number,
): CanvasPresence {
  const remote: CanvasPresence = states
    .filter(state => state.clientId !== localClientId)
    .map(state => [state.clientId, { user: state.user, cursor: state.cursor }]);
  remote.sort(([left], [right]) => left - right);
  const unchanged = current.length === remote.length && current.every(([id, state], index) => {
    const [nextId, next] = remote[index];
    return id === nextId && state.user?.id === next.user?.id &&
      state.user?.name === next.user?.name && state.user?.role === next.user?.role &&
      state.cursor?.x === next.cursor?.x && state.cursor?.y === next.cursor?.y;
  });
  return unchanged ? current : remote;
}
