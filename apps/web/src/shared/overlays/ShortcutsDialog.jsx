import { Dialog } from '../ui/Dialog.jsx';
import { SHORTCUTS } from '../a11y/shortcuts.js';

export function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
        {SHORTCUTS.map((s) => (
          <div key={s.description} style={{ display: 'contents' }}>
            <dt className="row" style={{ gap: 4 }}>
              {s.keys.map((k, i) => (
                <kbd key={`${k}-${i}`}>{k}</kbd>
              ))}
            </dt>
            <dd>{s.description}</dd>
          </div>
        ))}
      </dl>
      <p className="subtle" style={{ fontSize: 12 }}>
        On macOS use ⌘ instead of Ctrl. Letter shortcuts are ignored while typing in a field.
      </p>
    </Dialog>
  );
}
