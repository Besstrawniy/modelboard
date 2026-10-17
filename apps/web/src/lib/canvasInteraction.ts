/**
 * Preview updates should not be stored in Yjs at pointer-move frequency.
 * "select" is a per-user UI state, not shared document state.
 */
export function shouldPersistCanvasNodeChange(change: {
  type: string;
  dragging?: boolean;
  resizing?: boolean;
}): boolean {
  if (change.type === 'select') return false;
  if (change.type === 'position' && change.dragging === true) return false;
  if (change.type === 'dimensions' && change.resizing === true) return false;
  return true;
}
