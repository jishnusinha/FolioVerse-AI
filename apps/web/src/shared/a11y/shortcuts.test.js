import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveShortcut } from './shortcuts.js';

const key = (k, extra = {}) => ({ key: k, target: document.body, ...extra });

describe('resolveShortcut', () => {
  it('handles Ctrl/Cmd+K and Ctrl+\\ even while typing', () => {
    const input = document.createElement('input');
    expect(resolveShortcut(key('k', { ctrlKey: true, target: input }), { pendingG: false })).toEqual({ type: 'palette' });
    expect(resolveShortcut(key('K', { metaKey: true }), { pendingG: false })).toEqual({ type: 'palette' });
    expect(resolveShortcut(key('\\', { ctrlKey: true }), { pendingG: false })).toEqual({ type: 'rail' });
  });

  it('resolves g-sequences', () => {
    const s = { pendingG: false };
    expect(resolveShortcut(key('g'), s)).toEqual({ type: 'pending' });
    expect(resolveShortcut(key('k'), s)).toEqual({ type: 'go', to: '/app/knowledge' });
    expect(s.pendingG).toBe(false);
    for (const [letter, to] of [
      ['w', '/app/writer'],
      ['l', '/app/library'],
      ['d', '/app/discover'],
      ['s', '/app/studio'],
    ]) {
      resolveShortcut(key('g'), s);
      expect(resolveShortcut(key(letter), s)).toEqual({ type: 'go', to });
    }
  });

  it('opens help with ? and ignores unknown follow-ups', () => {
    expect(resolveShortcut(key('?'), { pendingG: false })).toEqual({ type: 'help' });
    const s = { pendingG: false };
    resolveShortcut(key('g'), s);
    expect(resolveShortcut(key('z'), s)).toBeNull();
  });

  it('ignores letters while typing', () => {
    const ta = document.createElement('textarea');
    const s = { pendingG: false };
    expect(resolveShortcut(key('g', { target: ta }), s)).toBeNull();
    expect(resolveShortcut(key('?', { target: ta }), s)).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('treats text inputs, textareas and contenteditable as typing targets', () => {
    const text = Object.assign(document.createElement('input'), { type: 'text' });
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    div.appendChild(inner);
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(inner)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
  });
});
