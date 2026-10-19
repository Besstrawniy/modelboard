import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Native picker previews locally; only the final choice enters collaborative history. */
export function ColorControl({ label, value, onChange, onPreview, children }: {
  label: string; value: string; onChange: (color: string) => void;
  onPreview?: (color: string) => void; children?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<string | null>(null);
  const commit = useRef(onChange);
  commit.current = onChange;
  useEffect(() => { if (!pending.current) setDraft(value); }, [value]);
  useEffect(() => {
    const element = input.current;
    const finish = () => { if (pending.current !== null) { const color = pending.current; pending.current = null; commit.current(color); } };
    element?.addEventListener('change', finish);
    element?.addEventListener('blur', finish);
    return () => { element?.removeEventListener('change', finish); element?.removeEventListener('blur', finish); finish(); };
  }, []);
  return <label className="color-control" title={label}>
    <span className="color-control__symbol">{children ?? 'A'}</span>
    <span className="color-control__sample" style={{ background: draft }}/>
    <input ref={input} aria-label={label} type="color" value={draft} onInput={event => {
      const color = event.currentTarget.value; pending.current = color; setDraft(color); onPreview?.(color);
    }} onChange={() => { /* The native change event commits once, after picker input events. */ }}/>
  </label>;
}
