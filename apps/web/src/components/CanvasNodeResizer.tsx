import { NodeResizer, useNodeId, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, type ComponentProps } from 'react';
import { RotateCw } from 'lucide-react';
import { useBoardActions } from './BoardContext';

/** Shared resize behaviour for every resizable canvas object. */
export function CanvasNodeResizer(props: ComponentProps<typeof NodeResizer>) {
  const { readOnly, keepAspectRatio, showTransformControls, updateNodeData } = useBoardActions();
  const id = useNodeId();
  const rf = useReactFlow();
  const updateInternals = useUpdateNodeInternals();
  const rotation = id ? rf.getNode(id)?.data.rotation : 0;
  const gesture = useRef<{ start: number; angle: number; value: number; element: HTMLElement; cx: number; cy: number } | null>(null);
  useEffect(() => {
    if (id) { const frame=requestAnimationFrame(()=>updateInternals(id)); return ()=>cancelAnimationFrame(frame); }
  }, [id, rotation, updateInternals]);
  useEffect(() => {
    const cancel = () => { gesture.current?.element.style.removeProperty('transform'); gesture.current=null; };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur',cancel); window.addEventListener('keydown',key);
    return () => { cancel(); window.removeEventListener('blur',cancel); window.removeEventListener('keydown',key); };
  }, []);
  if (readOnly || !showTransformControls || props.isVisible === false) return null;
  return <><NodeResizer {...props} keepAspectRatio={props.keepAspectRatio || keepAspectRatio} />
    {props.isVisible && <button className="canvas-rotation-handle nodrag nopan" aria-label="Повернуть объект" title="Поворот; Shift — шаг 15°"
      onPointerDown={(event) => {
        if (!id || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const element = event.currentTarget.parentElement!;
        const rect = element.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const angle = Number(rf.getNode(id)?.data.rotation ?? 0);
        gesture.current = { start: Math.atan2(event.clientY - cy, event.clientX - cx), angle, value: angle, element, cx, cy };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const g = gesture.current; if (!g) return;
        let value = g.angle + (Math.atan2(event.clientY-g.cy, event.clientX-g.cx)-g.start)*180/Math.PI;
        if (event.shiftKey) value = Math.round(value/15)*15;
        g.value = Math.round(value); g.element.style.transform = `rotate(${g.value}deg)`;
      }}
      onPointerUp={(event) => {
        const g=gesture.current; gesture.current=null;
        if (g && id) { g.element.style.removeProperty('transform'); updateNodeData(id,{rotation:g.value}); }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { gesture.current?.element.style.removeProperty('transform'); gesture.current=null; }}
      onLostPointerCapture={() => { gesture.current?.element.style.removeProperty('transform'); gesture.current=null; }}
    ><RotateCw size={13}/></button>}
  </>;
}
