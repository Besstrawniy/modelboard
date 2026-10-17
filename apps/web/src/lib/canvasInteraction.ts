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

export type CanvasPreview = {
  position?: { x: number; y: number };
  dragging?: boolean;
  resizing?: boolean;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

type CanvasNode = CanvasPreview & { id: string; selected?: boolean };

/** Shared data wins, except geometry currently controlled by a local gesture. */
export function reconcileCanvasNodes<T extends CanvasNode>(
  shared: T[], current: T[], previews: Map<string, CanvasPreview>,
): T[] {
  const local = new Map(current.map((node) => [node.id, node]));
  const ids = new Set(shared.map((node) => node.id));
  for (const id of previews.keys()) if (!ids.has(id)) previews.delete(id);
  return shared.map((node) => ({
    ...node,
    ...previews.get(node.id),
    selected: local.get(node.id)?.selected ?? false,
  }));
}

/** A geometry commit must retain concurrent text, style and binding edits. */
export function persistedCanvasGeometry<T extends CanvasNode>(
  shared: T, local: T, kind: 'position' | 'dimensions',
): T {
  if (kind === 'position') return { ...shared, position: local.position, dragging: false };
  return {
    ...shared,
    position: local.position ?? shared.position,
    dragging: false,
    width: local.width,
    height: local.height,
    measured: local.measured,
    resizing: false,
  };
}
