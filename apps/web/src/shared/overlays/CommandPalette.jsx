import { Command } from 'cmdk';
import { Icon } from '../icons.jsx';

/**
 * Command palette (Ctrl/Cmd+K). Commands either navigate (`to`) or run an action (`run`).
 * Pass `query`/`onQueryChange` to add live results (workspace search) as extra commands.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, commands: import('../commands.js').Command[], onNavigate: (to: string) => void,
 *   query?: string, onQueryChange?: (q: string) => void }} props
 */
export function CommandPalette({ open, onOpenChange, commands, onNavigate, query, onQueryChange }) {
  const groups = [...new Set(commands.map((c) => c.group))];
  const select = (c) => {
    onOpenChange(false);
    if (c.to) onNavigate(c.to);
    else c.run?.();
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="scrim"
      contentClassName="pal"
      loop
    >
      <Command.Input
        placeholder="Search screens, commands and this workspace…"
        aria-label="Search commands"
        {...(onQueryChange ? { value: query ?? '', onValueChange: onQueryChange } : {})}
      />
      <Command.List>
        <Command.Empty>No matching commands</Command.Empty>
        {groups.map((g) => (
          <Command.Group key={g} heading={g}>
            {commands
              .filter((c) => c.group === g)
              .map((c) => (
                <Command.Item key={c.id} value={`${c.group} ${c.label}`} keywords={c.keywords} onSelect={() => select(c)}>
                  <Icon name={c.to ? 'chev' : 'lens'} size={14} />
                  <span className="grow">{c.label}</span>
                  {c.hint && <span className="subtle">{c.hint}</span>}
                  {c.shortcut && (
                    <span className="row" style={{ gap: 3 }}>
                      {c.shortcut.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  )}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
