import type { FreehandStroke } from '@modelboard/shared';
import type { Node } from '@xyflow/react';
import { canvasNodeSize } from './canvasGeometry.ts';

/** Store strokes as regular canvas objects so all transforms, layers and history apply. */
export function strokeCanvasNode(stroke: FreehandStroke): Node {
  const padding = Math.max(stroke.width, 4);
  const x = Math.min(...stroke.points.map((p) => p.x)) - padding;
  const y = Math.min(...stroke.points.map((p) => p.y)) - padding;
  const width = Math.max(...stroke.points.map((p) => p.x)) - x + padding;
  const height = Math.max(...stroke.points.map((p) => p.y)) - y + padding;
  return { id: stroke.id, type: 'freehand', position: { x, y }, style: { width, height },
    data: { stroke: { ...stroke, points: stroke.points.map((p) => ({ x: p.x - x, y: p.y - y })) }, baseWidth: width, baseHeight: height } };
}

export function canvasNodeStroke(node: Node): FreehandStroke | undefined {
  if (node.type !== 'freehand' || !node.data.stroke) return undefined;
  const stroke = node.data.stroke as FreehandStroke;
  const width = canvasNodeSize(node, 'width', 1), height = canvasNodeSize(node, 'height', 1);
  const sx = width / Number(node.data.baseWidth || width), sy = height / Number(node.data.baseHeight || height);
  const angle = Number(node.data.rotation || 0) * Math.PI / 180;
  return { ...stroke, id: node.id, points: stroke.points.map((p) => {
    const x = p.x * sx - width / 2, y = p.y * sy - height / 2;
    return { x: node.position.x + width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
      y: node.position.y + height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
  }) };
}
