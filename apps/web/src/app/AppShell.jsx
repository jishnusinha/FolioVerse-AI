import { useEffect } from 'react';
import { NavLink, Outlet, useMatches } from 'react-router';
import {
  BookMarked,
  BookOpen,
  Compass,
  Feather,
  FlaskConical,
  House,
  LibraryBig,
  Moon,
  Receipt,
  Settings,
  Sun,
} from 'lucide-react';
import { SECTIONS } from './routes.js';
import { resolveTheme, useThemeStore } from '@/stores/theme.js';

const ICONS = {
  house: House,
  'library-big': LibraryBig,
  feather: Feather,
  'book-open': BookOpen,
  compass: Compass,
  'flask-conical': FlaskConical,
  receipt: Receipt,
  'book-marked': BookMarked,
};

function useApplyTheme() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(theme));
    apply();
    if (theme !== 'system' || typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return theme;
}

/** Gate 0 shell: rail + top bar + outlet. Gate 1 adds context panel, inspector, palette and overlays. */
export function AppShell() {
  const theme = useApplyTheme();
  const setTheme = useThemeStore((s) => s.setTheme);
  const matches = useMatches();
  const route = matches.at(-1)?.handle?.route;
  const forceDark = Boolean(route?.forceDark);
  const dark = forceDark || resolveTheme(theme) === 'dark';

  return (
    <div
      className={`grid h-full grid-cols-[var(--fv-rail)_1fr] grid-rows-[var(--fv-topbar)_1fr] bg-fv-bg text-fv-text ${forceDark ? 'studio' : ''}`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-fv-sm focus:bg-fv-raised focus:p-2"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="row-span-2 flex flex-col items-center gap-1 border-r border-fv-border bg-fv-sidebar py-3">
        <span className="mb-3 font-serif text-[length:var(--fv-fs-lg)] text-fv-accent" aria-label="FolioVerse">
          F
        </span>
        {SECTIONS.map((s) => {
          const Icon = ICONS[s.icon];
          return (
            <NavLink
              key={s.id}
              to={s.to}
              end={s.to === '/app'}
              title={s.label}
              aria-label={s.label}
              className={({ isActive }) =>
                `grid size-10 place-items-center rounded-fv-md text-fv-muted hover:bg-fv-hover hover:text-fv-text ${isActive ? 'bg-fv-selected text-fv-text' : ''}`
              }
            >
              <Icon size={18} aria-hidden />
            </NavLink>
          );
        })}
        <NavLink
          to="/app/settings"
          title="Settings"
          aria-label="Settings"
          className="mt-auto grid size-10 place-items-center rounded-fv-md text-fv-muted hover:bg-fv-hover hover:text-fv-text"
        >
          <Settings size={18} aria-hidden />
        </NavLink>
      </nav>
      <header className="flex items-center justify-between border-b border-fv-border bg-fv-surface px-4">
        <span className="text-[length:var(--fv-fs-sm)] text-fv-muted">{route?.title ?? 'FolioVerse'}</span>
        <button
          type="button"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
          disabled={forceDark}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="grid size-8 place-items-center rounded-fv-sm text-fv-muted hover:bg-fv-hover disabled:opacity-50"
        >
          {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </button>
      </header>
      <main id="main" tabIndex={-1} className="overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
