import { forwardRef } from 'react';
import { cn } from '../cn.js';

/**
 * @typedef {'default'|'primary'|'ghost'|'ai'|'danger'} ButtonVariant
 * @param {{ variant?: ButtonVariant, size?: 'md'|'sm', className?: string } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export const Button = forwardRef(function Button({ variant = 'default', size = 'md', className, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('btn', variant !== 'default' && variant, size === 'sm' && 'sm', className)}
      {...rest}
    />
  );
});

/** Square icon-only button; `label` is required for screen readers. */
export const IconButton = forwardRef(function IconButton({ label, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn('icon-btn', className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
});

export function Kbd({ children }) {
  return <kbd>{children}</kbd>;
}
