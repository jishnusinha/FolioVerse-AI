import { cn } from '../cn.js';

export function Card({ as: As = 'div', pad = true, className, ...rest }) {
  return <As className={cn('card', pad && 'pad', className)} {...rest} />;
}

/** @param {{ tone?: 'default'|'warn'|'bad'|'ai', children: import('react').ReactNode, className?: string }} props */
export function Callout({ tone = 'default', className, children, role }) {
  return (
    <div className={cn('callout', tone !== 'default' && tone, className)} role={role}>
      {children}
    </div>
  );
}

export function SectionHeading({ id, children, as: As = 'h2' }) {
  return (
    <As className="sect-h" id={id}>
      {children}
    </As>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

/** Placeholder block shown while content loads. */
export function Skeleton({ width = '100%', height = 14, className }) {
  return <span className={cn('skeleton', className)} style={{ width, height }} aria-hidden="true" />;
}

export function ScrollArea({ className, style, children, label }) {
  return (
    <div className={cn('scroll', className)} style={style} tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export function Separator({ vertical = false }) {
  return <div role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'} className={cn('sep', vertical && 'v')} />;
}

/** Determinate progress bar (0–100). */
export function Progress({ value, label, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <i style={{ width: `${v}%`, background: tone ? `var(--fv-${tone})` : undefined }} />
    </div>
  );
}

/**
 * Segmented control (single choice).
 * @param {{ options: { value: string, label: import('react').ReactNode }[], value: string, onChange: (v: string) => void, label: string }} props
 */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Key/value description list. */
export function KeyValue({ items, className }) {
  return (
    <dl className={cn('kv', className)}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
