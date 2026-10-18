import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canvasContextItems, clampCanvasMenuPosition, type CanvasContextCommand, type CanvasContextOptions } from '../lib/canvasContextMenu';

export function CanvasContextMenu({ x, y, options, onCommand, onClose }: {
  x: number;
  y: number;
  options: CanvasContextOptions;
  onCommand: (command: CanvasContextCommand) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'main' | 'align' | 'layers'>('main');
  const [position, setPosition] = useState({ x, y });
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
  }, []);
  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition(clampCanvasMenuPosition({ x, y }, bounds, { width: window.innerWidth, height: window.innerHeight }));
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [page, x, y, options.readOnly, options.selectionCount]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const scroll = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const run = (command: CanvasContextCommand) => {
    if (command === 'align-menu') setPage('align');
    else if (command === 'layers-menu') setPage('layers');
    else if (command === 'back') setPage('main');
    else {
      onClose();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
      onCommand(command);
    }
  };

  return createPortal(
    <div className="canvas-context-menu" ref={root} role="menu" aria-label="Действия Canvas"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const key = event.key.toLowerCase();
        const mod = event.ctrlKey || event.metaKey;
        let shortcut: CanvasContextCommand | undefined;
        if (mod && !event.altKey) {
          if (key === 'c') shortcut = 'copy';
          else if (key === 'v') shortcut = 'paste';
          else if (key === 'd') shortcut = 'duplicate';
          else if (key === 'g') shortcut = event.shiftKey ? 'ungroup' : 'group';
          else if (key === 'z') shortcut = event.shiftKey ? 'redo' : 'undo';
          else if (key === 'y') shortcut = 'redo';
          else if (key === '0') shortcut = 'fit-board';
          else if (event.code === 'BracketRight') shortcut = event.shiftKey ? 'layer:front' : 'layer:forward';
          else if (event.code === 'BracketLeft') shortcut = event.shiftKey ? 'layer:back' : 'layer:backward';
        } else if (!mod && !event.altKey) {
          if (event.key === 'Delete' || event.key === 'Backspace') shortcut = 'delete';
          else if (key === 'f') shortcut = options.selectionCount ? 'fit-selection' : 'fit-board';
        }
        if (shortcut) {
          const available = [...canvasContextItems(options).flat(), ...canvasContextItems(options, 'layers').flat()]
            .find((item) => item.command === shortcut && !item.disabled);
          event.preventDefault();
          if (available) run(shortcut);
          return;
        }
        if (event.key === 'ArrowLeft' && page !== 'main') {
          event.preventDefault();
          setPage('main');
          return;
        }
        if (event.key === 'ArrowRight') {
          const active = document.activeElement as HTMLButtonElement | null;
          const command = active?.dataset.command;
          if (command === 'align-menu' || command === 'layers-menu') {
            event.preventDefault();
            run(command);
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (page !== 'main') setPage('main');
          else {
            onClose();
            if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
          }
          return;
        }
        if (event.key === 'Tab') { onClose(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus({ preventScroll: true });
      }}>
      {canvasContextItems(options, page).map((group, i) => (
        <div role="group" key={i}>
          {group.map((item) => (
            <button key={item.command} data-command={item.command} role="menuitem" disabled={item.disabled}
              className={item.danger ? 'is-danger' : undefined}
              onClick={() => run(item.command)}>
              <span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>, document.body,
  );
}
