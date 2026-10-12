import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router';
import { SECTIONS } from './routes.js';
import { Icon, Logo } from '@/shared/icons.jsx';
import { cn } from '@/shared/cn.js';
import { resolveTheme, useThemeStore } from '@/stores/theme.js';
import { useUiStore } from '@/stores/ui.js';
import { useGlobalShortcuts } from '@/shared/a11y/shortcuts.js';
import { allCommands, useCommandRegistry } from '@/shared/commands.js';
import { CommandPalette } from '@/shared/overlays/CommandPalette.jsx';
import { ShortcutsDialog } from '@/shared/overlays/ShortcutsDialog.jsx';
import { Sheet } from '@/shared/ui/Dialog.jsx';
import { Toaster } from '@/shared/ui/toast.jsx';
import { DropdownMenu, TooltipProvider } from '@/shared/ui/Radix.jsx';
import { useQueryClient } from '@tanstack/react-query';
import { RequireSession } from '@/features/auth/RequireSession.jsx';
import { signOut, useCurrentWorkspace, useMe } from '@/features/auth/session.js';
import { useWorkspaceEvents } from '@/features/runs/useWorkspaceEvents.js';
import { useSearch } from '@/features/insights/queries.js';
import { SEARCH_GROUPS, searchHref, useDebouncedValue } from '@/features/insights/search.js';

const SEARCH_TYPE_LABEL = Object.fromEntries(SEARCH_GROUPS.map(([type, label]) => [type, label.replace(/s$/, '')]));

const SECTION_ICON = {
  home: 'home',
  knowledge: 'knowledge',
  writer: 'writer',
  library: 'library',
  discover: 'discover',
  studio: 'studio',
  costs: 'costs',
  docs: 'docs',
};
const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]));
SECTION_LABEL.admin = 'Administration';
SECTION_LABEL.settings = 'Settings';

/** Applies the theme preference to <html data-theme>, following the OS when set to system. */
export function useApplyTheme() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(theme));
    apply();
    if (theme !== 'system' || typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return resolveTheme(theme);
}

function NavItem({ to, icon, label, hideOnMobile, end }) {
  return (
    <NavLink to={to} end={end} title={label} className="nav-btn" data-m={hideOnMobile ? 'hide' : undefined}>
      <Icon name={icon} size={19} />
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

function Breadcrumbs({ route }) {
  const crumbs = [];
  if (route?.section && SECTION_LABEL[route.section] && SECTION_LABEL[route.section] !== route.title) {
    crumbs.push(SECTION_LABEL[route.section]);
  }
  crumbs.push(route?.title ?? 'FolioVerse');
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <span>FolioVerse</span>
      {crumbs.map((c, i) => (
        <span key={`${c}-${i}`} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <span aria-hidden="true">/</span>
          {i === crumbs.length - 1 ? <b aria-current="page">{c}</b> : <span>{c}</span>}
        </span>
      ))}
    </nav>
  );
}

function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?'
  );
}

function AccountMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = me.data?.user;
  return (
    <DropdownMenu
      align="start"
      trigger={
        <button type="button" className="nav-btn" data-m="hide" title={user?.email} aria-label={`Account: ${user?.displayName ?? ''}`}>
          <span className="avatar">{initials(user?.displayName)}</span>
          <span className="nav-label">{user?.displayName}</span>
        </button>
      }
      items={[
        { label: 'Settings', onSelect: () => navigate('/app/settings') },
        '-',
        {
          label: 'Sign out',
          onSelect: async () => {
            await signOut(qc).catch(() => undefined);
            navigate('/auth/login', { replace: true });
          },
        },
      ]}
    />
  );
}

/** Application shell for signed-in users. */
export function AppShell() {
  return (
    <RequireSession>
      <ShellFrame />
    </RequireSession>
  );
}

/** Navigation rail, top bar, main region and global overlays. */
function ShellFrame() {
  const resolved = useApplyTheme();
  const setTheme = useThemeStore((s) => s.setTheme);
  const railExpanded = useUiStore((s) => s.railExpanded);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const { toggleRail, togglePalette, setPaletteOpen, setShortcutsOpen, setNotificationsOpen } = useUiStore.getState();
  const sources = useCommandRegistry((s) => s.sources);
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const route = matches.at(-1)?.handle?.route;
  const forceDark = Boolean(route?.forceDark);
  const mainRef = useRef(null);
  const workspace = useCurrentWorkspace();
  useWorkspaceEvents(workspace?.id);

  const [paletteQuery, setPaletteQuery] = useState('');
  const searchTerm = useDebouncedValue(paletteQuery, 200);
  const found = useSearch(workspace?.id, searchTerm, { semantic: false, enabled: paletteOpen });
  const searchCommands = useMemo(() => {
    const q = paletteQuery.trim();
    if (q.length < 2) return [];
    const hits = (found.data?.items ?? []).slice(0, 8).map((it) => ({
      id: `hit:${it.type}:${it.id}`,
      label: it.title,
      group: 'In this workspace',
      to: searchHref(it),
      keywords: [q],
      hint: SEARCH_TYPE_LABEL[it.type],
    }));
    return [...hits, { id: 'search:all', label: `Search everywhere for “${q}”`, group: 'In this workspace', to: `/app/search?q=${encodeURIComponent(q)}`, keywords: [q] }];
  }, [found.data, paletteQuery]);
  const onPaletteOpenChange = useCallback(
    (o) => {
      setPaletteOpen(o);
      if (!o) setPaletteQuery('');
    },
    [setPaletteOpen],
  );

  const toggleTheme = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme]);
  const openHelp = useCallback(() => setShortcutsOpen(true), [setShortcutsOpen]);
  useGlobalShortcuts({ navigate, togglePalette, toggleRail, openHelp });

  useEffect(() => {
    document.title = `${route?.title ?? 'FolioVerse'} · FolioVerse`;
  }, [route]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.scrollTo?.(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const commands = useMemo(
    () =>
      allCommands(
        [
          { id: 'act:theme', label: 'Toggle light / dark theme', group: 'Actions', run: toggleTheme },
          { id: 'act:rail', label: 'Expand or collapse navigation', group: 'Actions', run: toggleRail, shortcut: ['Ctrl', '\\'] },
          { id: 'act:shortcuts', label: 'Show keyboard shortcuts', group: 'Actions', run: openHelp, shortcut: ['?'] },
        ],
        sources,
      ),
    [toggleTheme, toggleRail, openHelp, sources],
  );

  return (
    <TooltipProvider delayDuration={400}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className={cn('app', railExpanded && 'expanded')}>
        <nav className="rail" aria-label="Primary">
          <div className="brand">
            <Logo />
            <span className="nav-label">
              FolioVerse <span className="ai-mark">AI</span>
            </span>
          </div>
          {SECTIONS.map((s, i) => (
            <NavItem
              key={s.id}
              to={s.to}
              end={s.to === '/app'}
              icon={SECTION_ICON[s.id]}
              label={s.label}
              hideOnMobile={i > 4}
            />
          ))}
          <button type="button" className="nav-btn" data-m="only" aria-label="More destinations" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={19} />
          </button>
          <div className="rail-sep" />
          <div className="rail-bottom">
            <NavItem to="/app/settings" icon="settings" label="Settings" hideOnMobile />
            <button
              type="button"
              className="nav-btn"
              data-m="hide"
              title="Toggle theme"
              onClick={toggleTheme}
              aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={19} />
              <span className="nav-label">{resolved === 'dark' ? 'Light' : 'Dark'} theme</span>
            </button>
            <button
              type="button"
              className="nav-btn"
              data-m="hide"
              aria-expanded={railExpanded}
              title="Expand or collapse navigation (Ctrl \)"
              onClick={toggleRail}
            >
              <Icon name="panel" size={19} />
              <span className="nav-label">{railExpanded ? 'Collapse' : 'Expand'}</span>
            </button>
            <AccountMenu />
          </div>
        </nav>
        <div className="frame">
          <header className="topbar">
            <Breadcrumbs route={route} />
            <button type="button" className="search" aria-label="Search or run a command (Ctrl K)" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={16} />
              <span>Search or run a command</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button type="button" className="btn primary sm" onClick={() => setPaletteOpen(true)}>
              + New
            </button>
            <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
              <Icon name="bell" />
            </button>
          </header>
          <main id="main" ref={mainRef} tabIndex={-1} className={cn(forceDark && 'studio')}>
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={onPaletteOpenChange}
        commands={searchCommands.length ? [...commands, ...searchCommands] : commands}
        onNavigate={navigate}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen} title="Notifications">
        <p className="empty">No notifications yet. Ingestion results, budget alerts and proposed story facts will appear here.</p>
      </Sheet>
      <Toaster />
    </TooltipProvider>
  );
}
