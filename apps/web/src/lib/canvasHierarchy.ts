import { canvasNodeSize, type CanvasGeometryNode } from './canvasGeometry.ts';

export type HierarchyNode = CanvasGeometryNode & { data?: Record<string, unknown> };
export const containerId = (node: HierarchyNode): string | undefined =>
  typeof node.data?.containerId === 'string' ? node.data.containerId : undefined;

/** Explicit ownership, never inferred from visual overlap. Also tolerates old/cyclic data. */
export function canvasDescendants(nodes: HierarchyNode[], ids: ReadonlySet<string>): Set<string> {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!result.has(node.id) && result.has(containerId(node) ?? '')) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

export function canvasSelectionRoots(nodes: HierarchyNode[], ids: ReadonlySet<string>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    if (!ids.has(node.id)) return false;
    const seen = new Set([node.id]);
    let parent = containerId(node);
    while (parent && !seen.has(parent)) {
      if (ids.has(parent)) return false;
      seen.add(parent);
      parent = byId.has(parent) ? containerId(byId.get(parent)!) : undefined;
    }
    return true;
  });
}

export function canvasBounds(nodes: HierarchyNode[]) {
  const left = Math.min(...nodes.map((n) => n.position.x));
  const top = Math.min(...nodes.map((n) => n.position.y));
  const right = Math.max(...nodes.map((n) => n.position.x + canvasNodeSize(n, 'width', 180)));
  const bottom = Math.max(...nodes.map((n) => n.position.y + canvasNodeSize(n, 'height', 90)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Top-level moves carry owned descendants once, including nested containers. */
export function moveCanvasDescendants(nodes: HierarchyNode[], positions: Map<string, { x: number; y: number }>) {
  const result = new Map(positions);
  const roots = canvasSelectionRoots(nodes, new Set(positions.keys()));
  for (const root of roots) {
    const target = positions.get(root.id)!;
    const owned = canvasDescendants(nodes, new Set([root.id]));
    for (const node of nodes) {
      if (node.id === root.id || !owned.has(node.id)) continue;
      result.set(node.id, { x: node.position.x + target.x - root.position.x,
        y: node.position.y + target.y - root.position.y });
    }
  }
  return result;
}

/** Attach only to a completely enclosing frame, excluding self and descendants. */
export function enclosingCanvasFrame(nodes: HierarchyNode[], selected: ReadonlySet<string>) {
  const items = nodes.filter((node) => selected.has(node.id));
  if (!items.length) return undefined;
  const excluded = canvasDescendants(nodes, selected);
  const bounds = canvasBounds(items);
  return nodes.filter((node) => node.type === 'frame' && !excluded.has(node.id))
    .filter((node) => {
      const rect = canvasBounds([node]);
      return bounds.x >= rect.x && bounds.y >= rect.y &&
        bounds.x + bounds.width <= rect.x + rect.width && bounds.y + bounds.height <= rect.y + rect.height;
    }).sort((a, b) => {
      const aa = canvasBounds([a]), bb = canvasBounds([b]);
      return aa.width * aa.height - bb.width * bb.height;
    })[0];
}
