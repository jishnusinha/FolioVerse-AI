import { useEffect } from 'react';

/** Go-to sequences: press `g` then the letter. */
export const GO_TO = {
  h: '/app',
  k: '/app/knowledge',
  w: '/app/writer',
  l: '/app/library',
  d: '/app/discover',
  s: '/app/studio',
  c: '/app/costs',
};

/** Shortcut registry shown in the help dialog and the design gallery. */
export const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], description: 'Open or close the command palette' },
  { keys: ['Ctrl', '\\'], description: 'Expand or collapse the navigation rail' },
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['g', 'h'], description: 'Go to Home' },
  { keys: ['g', 'k'], description: 'Go to Folio Knowledge' },
  { keys: ['g', 'w'], description: 'Go to Folio Writer' },
  { keys: ['g', 'l'], description: 'Go to Library' },
  { keys: ['g', 'd'], description: 'Go to Discover' },
  { keys: ['g', 's'], description: 'Go to AI Developer Studio' },
  { keys: ['g', 'c'], description: 'Go to Cost Center' },
  { keys: ['Alt', 'L'], description: 'Move focus into an open Folio Lens' },
  { keys: ['Esc'], description: 'Close the Lens, drawer or dialog' },
];

/** True when key presses should be left to the focused control. */
export function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = /** @type {HTMLInputElement} */ (el).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return false;
}

/**
 * Pure key handler so it can be unit tested without a DOM listener.
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, target?: EventTarget|null }} ev
 * @param {{ pendingG: boolean }} state  mutable sequence state
 * @returns {null | { type: 'palette' } | { type: 'rail' } | { type: 'help' } | { type: 'go', to: string } | { type: 'pending' }}
 */
export function resolveShortcut(ev, state) {
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key;
  if (mod && key.toLowerCase() === 'k') return { type: 'palette' };
  if (mod && key === '\\') return { type: 'rail' };
  if (mod || ev.altKey || isTypingTarget(/** @type {Element} */ (ev.target))) {
    state.pendingG = false;
    return null;
  }
  if (state.pendingG) {
    state.pendingG = false;
    const to = GO_TO[key.toLowerCase()];
    return to ? { type: 'go', to } : null;
  }
  if (key === 'g') {
    state.pendingG = true;
    return { type: 'pending' };
  }
  if (key === '?') return { type: 'help' };
  return null;
}

/**
 * Installs the global shortcut listener.
 * @param {{ navigate: (to: string) => void, togglePalette: () => void, toggleRail: () => void, openHelp: () => void }} handlers
 */
export function useGlobalShortcuts({ navigate, togglePalette, toggleRail, openHelp }) {
  useEffect(() => {
    const state = { pendingG: false };
    let timer;
    const onKey = (ev) => {
      const r = resolveShortcut(ev, state);
      if (!r) return;
      clearTimeout(timer);
      if (r.type === 'pending') {
        timer = setTimeout(() => (state.pendingG = false), 1200);
        return;
      }
      ev.preventDefault();
      if (r.type === 'palette') togglePalette();
      else if (r.type === 'rail') toggleRail();
      else if (r.type === 'help') openHelp();
      else if (r.type === 'go') navigate(r.to);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [navigate, togglePalette, toggleRail, openHelp]);
}
