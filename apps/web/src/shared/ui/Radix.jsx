import * as RT from '@radix-ui/react-tabs';
import * as TT from '@radix-ui/react-tooltip';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as PO from '@radix-ui/react-popover';
import { cn } from '../cn.js';

/**
 * Tabs with the prototype underline style.
 * @param {{ tabs: { value: string, label: import('react').ReactNode, content: import('react').ReactNode }[],
 *   value?: string, defaultValue?: string, onValueChange?: (v: string) => void, label: string }} props
 */
export function Tabs({ tabs, value, defaultValue, onValueChange, label }) {
  return (
    <RT.Root value={value} defaultValue={defaultValue ?? tabs[0]?.value} onValueChange={onValueChange}>
      <RT.List className="tabs" aria-label={label}>
        {tabs.map((t) => (
          <RT.Trigger key={t.value} value={t.value}>
            {t.label}
          </RT.Trigger>
        ))}
      </RT.List>
      {tabs.map((t) => (
        <RT.Content key={t.value} value={t.value} className="tab-panel">
          {t.content}
        </RT.Content>
      ))}
    </RT.Root>
  );
}

export const TooltipProvider = TT.Provider;

/** Hover/focus tooltip. Wrap the app in TooltipProvider. */
export function Tooltip({ content, children, side = 'top' }) {
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content className="tip" side={side} sideOffset={6}>
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

/**
 * Dropdown menu.
 * @param {{ trigger: import('react').ReactElement, items: ({ label: string, onSelect: () => void, danger?: boolean, disabled?: boolean } | '-')[], align?: 'start'|'end' }} props
 */
export function DropdownMenu({ trigger, items, align = 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu" align={align} sideOffset={6}>
          {items.map((it, i) =>
            it === '-' ? (
              <DM.Separator key={`sep-${i}`} className="menu-sep" />
            ) : (
              <DM.Item
                key={it.label}
                className={cn('menu-item', it.danger && 'danger')}
                disabled={it.disabled}
                onSelect={it.onSelect}
              >
                {it.label}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Click-triggered popover anchored to its trigger. */
export function Popover({ trigger, children, open, onOpenChange, align = 'center', label }) {
  return (
    <PO.Root open={open} onOpenChange={onOpenChange}>
      <PO.Trigger asChild>{trigger}</PO.Trigger>
      <PO.Portal>
        <PO.Content className="popover" align={align} sideOffset={8} aria-label={label}>
          {children}
        </PO.Content>
      </PO.Portal>
    </PO.Root>
  );
}
