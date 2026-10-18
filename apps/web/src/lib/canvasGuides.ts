import { canvasNodeSize, type CanvasGeometryNode } from './canvasGeometry.ts';

export function snapCanvasGuides(node: CanvasGeometryNode, others: CanvasGeometryNode[], zoom: number) {
  const width = canvasNodeSize(node, 'width', 180), height = canvasNodeSize(node, 'height', 90);
  const position = { ...node.position };
  const guides: { axis: 'x' | 'y'; value: number }[] = [];
  for (const axis of ['x','y'] as const) {
    const size = axis === 'x' ? width : height;
    let distance = 6 / zoom, delta = 0, value: number | undefined;
    for (const other of others) {
      const otherSize = canvasNodeSize(other, axis === 'x' ? 'width' : 'height', axis === 'x' ? 180 : 90);
      for (const target of [other.position[axis],other.position[axis]+otherSize/2,other.position[axis]+otherSize]) {
        for (const own of [node.position[axis],node.position[axis]+size/2,node.position[axis]+size]) {
          if (Math.abs(target-own) < distance) { distance=Math.abs(target-own); delta=target-own; value=target; }
        }
      }
    }
    position[axis]+=delta;
    if (value !== undefined) guides.push({axis,value});
  }
  return { position, guides };
}
