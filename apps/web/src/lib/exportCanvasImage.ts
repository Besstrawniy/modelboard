import type { Node } from '@xyflow/react';
import { getNodesBounds } from '@xyflow/react';
import { downloadFile } from './fileFormats';
export async function exportCanvasImage(
  nodes: Node[],
  name: string,
  format: 'png' | 'svg',
) {
  if (!nodes.length) throw new Error('На доске нет объектов');
  const element = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!element) throw new Error('Доска ещё загружается');
  const bounds = getNodesBounds(nodes),
    padding = 24,
    scale = Math.min(
      1,
      4096 / (bounds.width + padding * 2),
      4096 / (bounds.height + padding * 2),
    );
  const width = Math.ceil((bounds.width + padding * 2) * scale),
    height = Math.ceil((bounds.height + padding * 2) * scale);
  const { toPng, toSvg } = await import('html-to-image');
  const options = {
    width,
    height,
    pixelRatio: 1,
    backgroundColor: '#ffffff',
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${(padding - bounds.x) * scale}px,${(padding - bounds.y) * scale}px) scale(${scale})`,
      transformOrigin: '0 0',
    },
    filter: (node: HTMLElement) =>
      !node.classList?.contains('react-flow__resize-control') &&
      !node.classList?.contains('canvas-rotation-handle') &&
      !node.classList?.contains('remote-cursor') &&
      !node.classList?.contains('canvas-guides'),
  };
  const data = await (format === 'png' ? toPng : toSvg)(element, options);
  const response = await fetch(data);
  downloadFile(`${name}.${format}`, await response.blob());
}
