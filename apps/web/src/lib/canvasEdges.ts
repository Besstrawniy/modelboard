import type { Edge } from '@xyflow/react';

export const DEFAULT_EDGE_STYLE = { stroke: '#64748b', strokeWidth: 2 } as const;

/** Render legacy edges and newly created connectors with the same defaults. */
export function edgeWithDefaults(edge: Edge): Edge {
  return { ...edge, style: {
    ...edge.style,
    stroke: edge.style?.stroke ?? DEFAULT_EDGE_STYLE.stroke,
    strokeWidth: edge.style?.strokeWidth ?? DEFAULT_EDGE_STYLE.strokeWidth,
  } };
}
