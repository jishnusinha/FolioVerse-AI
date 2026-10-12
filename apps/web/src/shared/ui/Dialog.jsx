import { useCallback, useLayoutEffect, useRef } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { cn } from '../cn.js';
import { Icon } from '../icons.jsx';

/**
 * Radix returns focus only to its own Trigger; our dialogs are opened from arbitrary controls,
 * so remember the focused element at open time and restore it on close.
 */
function useReturnFocus(open) {
  const origin = useRef(null);
  useLayoutEffect(() => {
    if (open) origin.current = document.activeElement;
  }, [open]);
  return useCallback((event) => {
    const el = origin.current;
    if (el instanceof HTMLElement && document.body.contains(el)) {
      event.preventDefault();
      el.focus({ preventScroll: true });
    }
  }, []);
}

/**
 * Centered modal dialog. Radix handles focus trap, Escape and focus restore.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, title: import('react').ReactNode,
 *   description?: import('react').ReactNode, children?: import('react').ReactNode, footer?: import('react').ReactNode, className?: string }} props
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }) {
  const onCloseAutoFocus = useReturnFocus(open);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="scrim" />
        <RD.Content className={cn('dialog', className)} onCloseAutoFocus={onCloseAutoFocus}>
          <div className="drawer-h">
            <RD.Title className="row" style={{ fontSize: 15 }}>
              {title}
            </RD.Title>
            <span className="grow" />
            <RD.Close className="icon-btn" aria-label="Close dialog">
              <Icon name="x" />
            </RD.Close>
          </div>
          {description ? (
            <RD.Description className="muted" style={{ padding: '12px 16px 0' }}>
              {description}
            </RD.Description>
          ) : (
            <RD.Description className="sr">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>
          )}
          <div className="drawer-b">{children}</div>
          {footer && <div className="dialog-f">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/**
 * Side sheet (drawer) anchored right, 440px or 620px wide. `modal={false}` keeps the page interactive.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, title: import('react').ReactNode,
 *   children?: import('react').ReactNode, wide?: boolean, modal?: boolean, label?: string }} props
 */
export function Sheet({ open, onOpenChange, title, children, wide = false, modal = true, label }) {
  const onCloseAutoFocus = useReturnFocus(open);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RD.Portal>
        {modal && <RD.Overlay className="scrim" />}
        <RD.Content
          className={cn('drawer', wide && 'wide')}
          aria-label={label}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
        >
          <div className="drawer-h">
            <RD.Title className="row" style={{ fontSize: 15 }}>
              {title}
            </RD.Title>
            <span className="grow" />
            <RD.Close className="icon-btn" aria-label="Close panel">
              <Icon name="x" />
            </RD.Close>
          </div>
          <RD.Description className="sr">{label || (typeof title === 'string' ? title : 'Panel')}</RD.Description>
          <div className="drawer-b">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
