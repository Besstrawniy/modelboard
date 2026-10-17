import { NodeResizer } from '@xyflow/react';
import type { ComponentProps } from 'react';
import { useBoardActions } from './BoardContext';

/** Shared resize behaviour for every resizable canvas object. */
export function CanvasNodeResizer(props: ComponentProps<typeof NodeResizer>) {
  const { readOnly, keepAspectRatio } = useBoardActions();
  if (readOnly) return null;
  return <NodeResizer {...props} keepAspectRatio={props.keepAspectRatio || keepAspectRatio} />;
}
