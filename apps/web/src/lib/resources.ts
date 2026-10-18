const seen = new Set<string>();
/** Provider messages are workspace-scoped by the collaboration server. */
export function receiveResourceMessage(payload: string) {
  try {
    const message = JSON.parse(payload);
    if (
      message.type === 'resources' &&
      (!message.eventId || !seen.has(message.eventId))
    ) {
      if (message.eventId) {
        seen.add(message.eventId);
        if (seen.size > 64) seen.delete(seen.values().next().value!);
      }
      window.dispatchEvent(
        new CustomEvent('modelboard:resources', { detail: message }),
      );
    }
    return message;
  } catch {
    return null;
  }
}
