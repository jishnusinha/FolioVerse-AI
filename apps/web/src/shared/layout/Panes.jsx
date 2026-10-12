import { cn } from '../cn.js';

/**
 * Multi-pane page body: optional context panel (260px), main pane and optional inspector (330px).
 * Collapses responsively via the prototype's breakpoint rules.
 * @param {{ context?: import('react').ReactNode, inspector?: import('react').ReactNode, children: import('react').ReactNode,
 *   contextLabel?: string, inspectorLabel?: string, className?: string, columns?: string }} props
 */
export function Panes({ context, inspector, children, contextLabel = 'Context', inspectorLabel = 'Inspector', className, columns }) {
  const cols =
    columns ??
    [context ? 'var(--fv-context)' : null, 'minmax(var(--fv-pane-min), 1fr)', inspector ? 'var(--fv-inspector)' : null]
      .filter(Boolean)
      .join(' ');
  return (
    <div className={cn('panes', 'fv-panes', className)} style={{ gridTemplateColumns: cols }}>
      {context && (
        <aside className="ctx" aria-label={contextLabel}>
          {context}
        </aside>
      )}
      <div className="pane">{children}</div>
      {inspector && (
        <aside className="side" aria-label={inspectorLabel}>
          {inspector}
        </aside>
      )}
    </div>
  );
}

/** Standard centred page with max content width. */
export function Page({ children, className }) {
  return <div className={cn('page', className)}>{children}</div>;
}

/** Page header: eyebrow, title, lede and right-aligned actions. */
export function PageHeader({ eyebrow, title, lede, actions }) {
  return (
    <header className="home-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
