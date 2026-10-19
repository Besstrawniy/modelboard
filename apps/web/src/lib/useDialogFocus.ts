import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
const selector = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';
function focusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden');
}

/** One focus boundary per modal, including modals rendered through portals. */
export function useDialogFocus<T extends HTMLElement = HTMLElement>({
  open = true, onClose, containerRef,
}: { open?: boolean; onClose: () => void; containerRef?: RefObject<T | null> }) {
  const ownRef = useRef<T>(null);
  const ref = containerRef ?? ownRef;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogs.push(root);
    const isTop = () => dialogs.at(-1) === root;
    const focusFirst = () => (focusable(root)[0] ?? root).focus({ preventScroll: true });
    if (!root.contains(document.activeElement)) focusFirst();
    const containFocus = (event: FocusEvent) => {
      if (isTop() && !root.contains(event.target as Node)) focusFirst();
    };
    const containTab = (event: globalThis.KeyboardEvent) => {
      if (!isTop() || event.key !== 'Tab') return;
      const elements = focusable(root);
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (!elements.length || index < 0 || (event.shiftKey ? index === 0 : index === elements.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? elements.at(-1) ?? root : elements[0] ?? root).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', containFocus, true);
    document.addEventListener('keydown', containTab, true);
    return () => {
      const wasTop = isTop();
      const index = dialogs.indexOf(root);
      if (index >= 0) dialogs.splice(index, 1);
      document.removeEventListener('focusin', containFocus, true);
      document.removeEventListener('keydown', containTab, true);
      if (!wasTop) return;
      const parent = dialogs.at(-1);
      if (previous?.isConnected && (!parent || parent.contains(previous))) previous.focus({ preventScroll: true });
      else if (parent) (focusable(parent)[0] ?? parent).focus({ preventScroll: true });
    };
  }, [open, ref]);
  return {
    ref,
    tabIndex: -1,
    onKeyDown(event: KeyboardEvent<T>) {
      if (event.key !== 'Escape' || event.defaultPrevented || dialogs.at(-1) !== ref.current) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
  };
}
