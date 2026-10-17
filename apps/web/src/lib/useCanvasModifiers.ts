import { useEffect, useState } from 'react';

/** One listener set per board, shared by all resize handles. */
export function useCanvasModifiers() {
  const [modifiers, setModifiers] = useState({ alt: false, shift: false });
  useEffect(() => {
    const update = (event: KeyboardEvent | PointerEvent) => {
      setModifiers((current) => current.alt === event.altKey && current.shift === event.shiftKey
        ? current : { alt: event.altKey, shift: event.shiftKey });
    };
    const reset = () => setModifiers((current) => current.alt || current.shift ? { alt: false, shift: false } : current);
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('pointerdown', update, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('pointerdown', update, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return modifiers;
}
