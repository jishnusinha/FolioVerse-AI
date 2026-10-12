import { forwardRef, lazy, Suspense } from 'react';
import { Skeleton } from '@/shared/ui/index.js';

const EpubEngine = lazy(() => import('./EpubEngine.jsx'));
const PdfEngine = lazy(() => import('./PdfEngine.jsx'));

/**
 * ReaderEngine adapter. Both engines take the same props and expose the same handle, and speak the unified
 * Locator (see locator.js), so the Reader page does not know which format it shows.
 *
 * Props: `{ kind: 'epub'|'pdf', data: ArrayBuffer, initial: Locator|null, prefs: { fontSize, theme, width, font },
 *   highlights: { id, color, locator }[], onReady({ toc }), onRelocate(locator), onSelect({ text, rect, locator, clear }|null),
 *   onHighlightClick(id) }`.
 * Handle: `{ goTo(locator|href|page), next(), prev() }`.
 */
export const ReaderEngine = forwardRef(function ReaderEngine({ kind, ...props }, ref) {
  const Engine = kind === 'pdf' ? PdfEngine : EpubEngine;
  return (
    <Suspense fallback={<Skeleton height={420} />}>
      <Engine ref={ref} {...props} />
    </Suspense>
  );
});
