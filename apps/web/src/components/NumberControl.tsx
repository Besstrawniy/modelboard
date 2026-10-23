import { useEffect, useRef, useState } from 'react';

/** Keep incomplete typing local; publish valid values and normalize on commit. */
export function NumberControl({ value, min, max, step = 1, label, onChange }: {
  value: number; min: number; max: number; step?: number; label: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const original = useRef(value);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const number = draft.trim() ? Number(draft) : value;
    const next = Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return <input aria-label={label} title={label} type="number" min={min} max={max} step={step}
    value={draft}
    onFocus={() => { editing.current = true; original.current = value; }}
    onChange={event => {
      const text = event.target.value;
      setDraft(text);
      const number = Number(text);
      if (text.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(number);
    }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        setDraft(String(original.current));
        onChange(original.current);
      }
    }} />;
}
