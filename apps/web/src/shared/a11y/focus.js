import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable descendants of `root`, in DOM order. */
export function focusableIn(root) {
  return root ? [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert]')) : [];
}

/** Remembers the focused element when `active` turns true and restores it when it turns false. */
export function useRestoreFocus(active) {
  const origin = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    origin.current = document.activeElement;
    return () => {
      const el = origin.current;
      if (el && el instanceof HTMLElement && document.body.contains(el)) el.focus({ preventScroll: true });
    };
  }, [active]);
}

/** Keeps Tab / Shift+Tab inside `ref` while `active`. */
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (ev) => {
      if (ev.key !== 'Tab' || !ref.current) return;
      const f = focusableIn(ref.current);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

/**
 * Roving tabindex for a composite widget (toolbar, listbox, menu).
 * @param {number} count
 * @param {{ orientation?: 'vertical'|'horizontal'|'both', loop?: boolean, initial?: number }} [opts]
 */
export function useRovingTabIndex(count, { orientation = 'vertical', loop = true, initial = 0 } = {}) {
  const [active, setActive] = useState(initial);
  const refs = useRef([]);
  const focusAt = useCallback(
    (i) => {
      if (!count) return;
      const n = loop ? (i + count) % count : Math.max(0, Math.min(count - 1, i));
      setActive(n);
      refs.current[n]?.focus({ preventScroll: true });
    },
    [count, loop],
  );
  const onKeyDown = useCallback(
    (ev) => {
      const prev = orientation === 'horizontal' ? ['ArrowLeft'] : orientation === 'vertical' ? ['ArrowUp'] : ['ArrowUp', 'ArrowLeft'];
      const next = orientation === 'horizontal' ? ['ArrowRight'] : orientation === 'vertical' ? ['ArrowDown'] : ['ArrowDown', 'ArrowRight'];
      if (next.includes(ev.key)) focusAt(active + 1);
      else if (prev.includes(ev.key)) focusAt(active - 1);
      else if (ev.key === 'Home') focusAt(0);
      else if (ev.key === 'End') focusAt(count - 1);
      else return;
      ev.preventDefault();
    },
    [active, count, focusAt, orientation],
  );
  const getItemProps = (i) => ({
    ref: (el) => (refs.current[i] = el),
    tabIndex: i === active ? 0 : -1,
    onKeyDown,
    onFocus: () => setActive(i),
  });
  return { active, setActive, focusAt, getItemProps };
}
