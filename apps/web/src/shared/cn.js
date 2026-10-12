import clsx from 'clsx';

/** Join class names; accepts strings, arrays and `{ cls: condition }` objects. */
export function cn(...args) {
  return clsx(...args);
}
