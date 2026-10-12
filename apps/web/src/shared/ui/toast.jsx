import { create } from 'zustand';
import { Icon } from '../icons.jsx';

let seq = 0;

/**
 * @typedef {{ id: number, message: string, tone: 'info'|'ok'|'warn'|'bad'|'ai', action?: { label: string, onClick: () => void } }} ToastItem
 */
export const useToasts = create((set, get) => ({
  /** @type {ToastItem[]} */
  items: [],
  /** @param {Omit<ToastItem,'id'|'tone'> & { tone?: ToastItem['tone'], duration?: number }} t */
  push: (t) => {
    const id = ++seq;
    const item = { id, tone: 'info', ...t };
    set({ items: [...get().items, item] });
    const ms = t.duration ?? (t.action ? 8000 : 4500);
    if (ms > 0) setTimeout(() => get().dismiss(id), ms);
    return id;
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
}));

/** Show a toast from anywhere. */
export const toast = (message, tone = 'info', action) => useToasts.getState().push({ message, tone, action });

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone} role={t.tone === 'bad' ? 'alert' : 'status'}>
          <span className="grow">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                t.action.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
