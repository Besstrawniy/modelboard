/** Commands follow physical keys, independently of the active input layout. */
export function shortcutKey(event: { key: string; code?: string }) {
  if (/^Key[A-Z]$/.test(event.code ?? '')) return event.code!.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code ?? '')) return event.code!.slice(5);
  return event.key.toLowerCase();
}
