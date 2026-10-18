export type CanvasGeometryNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  style?: { width?: number | string; height?: number | string };
  zIndex?: number;
};

export type CanvasAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type CanvasDistribution = 'horizontal' | 'vertical';
export type CanvasLayerAction = 'front' | 'back' | 'forward' | 'backward';
type Position = CanvasGeometryNode['position'];

export function canvasNodeSize(node: CanvasGeometryNode, key: 'width' | 'height', fallback: number) {
  for (const value of [node.measured?.[key], node[key], node.style?.[key]]) {
    const size = Number(value);
    if (Number.isFinite(size) && size > 0) return size;
  }
  return fallback;
}

function size(node: CanvasGeometryNode, axis: 'x' | 'y') {
  return canvasNodeSize(node, axis === 'x' ? 'width' : 'height',
    node.type === 'frame' ? (axis === 'x' ? 720 : 460) : (axis === 'x' ? 180 : 90));
}

function setChanged(positions: Map<string, Position>, node: CanvasGeometryNode, position: Position) {
  if (Math.abs(position.x - node.position.x) > 1e-6 || Math.abs(position.y - node.position.y) > 1e-6) {
    positions.set(node.id, position);
  }
}

export function alignCanvasNodes(nodes: CanvasGeometryNode[], selected: ReadonlySet<string>, mode: CanvasAlignment) {
  const items = nodes.filter((node) => selected.has(node.id));
  const positions = new Map<string, Position>();
  if (items.length < 2) return positions;
  const axis = ['left', 'center', 'right'].includes(mode) ? 'x' : 'y';
  const start = Math.min(...items.map((node) => node.position[axis]));
  const end = Math.max(...items.map((node) => node.position[axis] + size(node, axis)));
  const fraction = mode === 'center' || mode === 'middle' ? 0.5 : mode === 'right' || mode === 'bottom' ? 1 : 0;
  const target = start + (end - start) * fraction;
  for (const node of items) {
    setChanged(positions, node, { ...node.position, [axis]: target - size(node, axis) * fraction });
  }
  return positions;
}

/** Equal edge-to-edge gaps; the first and last objects stay fixed. */
export function distributeCanvasNodes(nodes: CanvasGeometryNode[], selected: ReadonlySet<string>, mode: CanvasDistribution) {
  const axis = mode === 'horizontal' ? 'x' : 'y';
  const items = nodes.filter((node) => selected.has(node.id))
    .sort((a, b) => a.position[axis] - b.position[axis]);
  const positions = new Map<string, Position>();
  if (items.length < 3) return positions;
  const first = items[0];
  const last = items[items.length - 1];
  const span = last.position[axis] + size(last, axis) - first.position[axis];
  const gap = (span - items.reduce((total, node) => total + size(node, axis), 0)) / (items.length - 1);
  let cursor = first.position[axis] + size(first, axis) + gap;
  for (const node of items.slice(1, -1)) {
    setChanged(positions, node, { ...node.position, [axis]: cursor });
    cursor += size(node, axis) + gap;
  }
  return positions;
}

/** Match Frame drag semantics; selected objects follow their own transforms. */
export function includeCanvasFrameContents(
  nodes: CanvasGeometryNode[], positions: Map<string, Position>, selected: ReadonlySet<string>,
) {
  const result = new Map(positions);
  const frames = nodes.filter((node) => node.type === 'frame' && positions.has(node.id))
    .sort((a, b) => size(a, 'x') * size(a, 'y') - size(b, 'x') * size(b, 'y'));
  for (const node of nodes) {
    if (selected.has(node.id) || node.type === 'frame') continue;
    const centerX = node.position.x + size(node, 'x') / 2;
    const centerY = node.position.y + size(node, 'y') / 2;
    const frame = frames.find((frame) => centerX >= frame.position.x && centerY >= frame.position.y &&
      centerX <= frame.position.x + size(frame, 'x') && centerY <= frame.position.y + size(frame, 'y'));
    if (!frame) continue;
    const target = positions.get(frame.id)!;
    setChanged(result, node, {
      x: node.position.x + target.x - frame.position.x,
      y: node.position.y + target.y - frame.position.y,
    });
  }
  return result;
}

/** Stable ordering: selected blocks move past one neighbour without reversing. */
export function reorderCanvasLayers(nodes: CanvasGeometryNode[], selected: ReadonlySet<string>, action: CanvasLayerAction) {
  const original = [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  let ordered = [...original];
  if (action === 'front' || action === 'back') {
    const chosen = ordered.filter((node) => selected.has(node.id));
    const rest = ordered.filter((node) => !selected.has(node.id));
    ordered = action === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  } else if (action === 'forward') {
    for (let i = ordered.length - 2; i >= 0; i--) {
      if (selected.has(ordered[i].id) && !selected.has(ordered[i + 1].id)) {
        [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
      }
    }
  } else {
    for (let i = 1; i < ordered.length; i++) {
      if (selected.has(ordered[i].id) && !selected.has(ordered[i - 1].id)) {
        [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]];
      }
    }
  }
  const result = new Map<string, number>();
  if (ordered.every((node, i) => node.id === original[i].id)) return result;
  const base = Math.min(0, ...original.map((node) => node.zIndex ?? 0));
  ordered.forEach((node, i) => {
    if ((node.zIndex ?? 0) !== base + i) result.set(node.id, base + i);
  });
  return result;
}

/** Find an unoccupied slot for palette insertion rather than stacking objects. */
export function canvasInsertionPosition(nodes:CanvasGeometryNode[],center:Position,width:number,height:number){
 const obstacles=nodes.filter(node=>node.type!=='frame'&&node.type!=='group'&&node.type!=='freehand');
 const free=(point:Position)=>!obstacles.some(node=>point.x<node.position.x+canvasNodeSize(node,'width',220)+18&&point.x+width+18>node.position.x&&point.y<node.position.y+canvasNodeSize(node,'height',130)+18&&point.y+height+18>node.position.y);
 const origin={x:center.x-width/2,y:center.y-height/2};
 if(free(origin))return origin;
 for(let ring=1;ring<=30;ring++)for(let y=-ring;y<=ring;y++)for(let x=-ring;x<=ring;x++){if(Math.max(Math.abs(x),Math.abs(y))!==ring)continue;const point={x:origin.x+x*(width+30),y:origin.y+y*(height+30)};if(free(point))return point;}
 return {x:origin.x+(obstacles.length+1)*(width+30),y:origin.y};
}
