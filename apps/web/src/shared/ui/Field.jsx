import { forwardRef } from 'react';
import { cn } from '../cn.js';

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn('input', className)} {...rest} />;
});

/** Native select: accessible by default and consistent across platforms. */
export const Select = forwardRef(function Select({ className, options, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn('select', className)} {...rest}>
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
});

/** Label wrapper: renders the label text above its control, with optional hint and error. */
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cn('fld', className)}>
      {label}
      {children}
      {hint && !error && <span className="subtle">{hint}</span>}
      {error && (
        <span role="alert" style={{ color: 'var(--fv-bad)' }}>
          {error}
        </span>
      )}
    </label>
  );
}
