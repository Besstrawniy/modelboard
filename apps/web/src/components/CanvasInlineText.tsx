import { useEffect, useRef, useState } from 'react';
import { useBoardActions } from './BoardContext';

/** A single transaction per edit; draft typing cannot swallow canvas hotkeys or overwrite remote edits. */
export function CanvasInlineText({ id, field = 'text', value, placeholder = '', className = '', multiline = true, minimumRows = 1 }: {
  id: string; field?: string; value: string; placeholder?: string; className?: string; multiline?: boolean; minimumRows?: number;
}) {
  const { readOnly, updateNodeData } = useBoardActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const startValue = useRef(value);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const active = useRef(false);
  const finish = () => {
    if (!active.current) return;
    active.current = false;
    if (!cancelled.current && draft !== startValue.current) updateNodeData(id, { [field]: draft });
    setEditing(false);
  };
  if (editing && !readOnly) return <textarea rows={minimumRows} ref={input} className={`canvas-inline-editor nodrag nowheel ${className}`}
    aria-label={placeholder || 'Текст объекта'} value={draft}
    onChange={(event) => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; active.current = false; setEditing(false); }
      else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); }
    }} />;
  return <div className={`canvas-inline-text ${className}`} tabIndex={readOnly ? undefined : 0}
    title={readOnly ? undefined : 'Двойной клик или Enter — редактировать; Esc — отменить'}
    onDoubleClick={(event) => { if (readOnly) return; event.stopPropagation(); active.current = true; cancelled.current = false; startValue.current = value; setDraft(value); setEditing(true); }}
    onKeyDown={(event) => { if (!readOnly && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); active.current = true; cancelled.current = false; startValue.current = value; setDraft(value); setEditing(true); } }}>
    {value || placeholder || '\u00a0'}
  </div>;
}
