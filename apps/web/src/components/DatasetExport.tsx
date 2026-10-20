import { ExternalLink } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DatasetSnapshot } from '@modelboard/shared';
import { exportDatasetFile } from '../lib/fileFormats';

const formats = [
  ['xlsx', 'Excel (.xlsx)'],
  ['csv', 'CSV (.csv)'],
  ['json', 'JSON с форматами и формулами'],
] as const;

export function DatasetExport({ dataset }: { dataset: DatasetSnapshot }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus=useRef(false);
  const close = () => { restoreFocus.current=true; setOpen(false); };
  // Restore after React has removed the menu and enabled the trigger.
  useLayoutEffect(()=>{
    if(!open&&!busy&&restoreFocus.current){restoreFocus.current=false;trigger.current?.focus({preventScroll:true});}
  },[open,busy]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <span className="dataset-export" ref={root} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
    }
    if (event.key === 'Tab') setOpen(false);
  }}>
    <button ref={trigger} title="Экспорт таблицы" aria-label="Экспорт таблицы" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}><ExternalLink size={16}/></button>
    {open && <span className="dataset-export__menu" role="menu" aria-label="Формат экспорта таблицы">
      {formats.map(([format, label]) => <button key={format} role="menuitem" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await exportDatasetFile(dataset, format); close(); }
        catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
      }}>{label}</button>)}
    </span>}
    {busy && <span role="status">Экспорт…</span>}
    {error && <span role="alert">{error}</span>}
  </span>;
}
