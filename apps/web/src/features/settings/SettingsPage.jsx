import { NavLink, Navigate, useParams } from 'react-router';
import { useThemeStore } from '@/stores/theme.js';
import { useUiStore } from '@/stores/ui.js';
import { Callout, Segmented } from '@/shared/ui/index.js';
import { Panes } from '@/shared/layout/Panes.jsx';

const TABS = [
  ['appearance', 'Appearance', null],
  ['profile', 'Profile', 2],
  ['workspace', 'Workspace', 2],
  ['models', 'Models', 3],
  ['budgets', 'Budgets', 9],
  ['privacy', 'Privacy', 2],
  ['notifications', 'Notifications', 2],
];

function Appearance() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const railExpanded = useUiStore((s) => s.railExpanded);
  const toggleRail = useUiStore((s) => s.toggleRail);
  return (
    <div className="form">
      <div className="fld">
        <span id="theme-l">Theme</span>
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
        <span className="subtle">System follows your operating system. AI Developer Studio always uses the dark theme.</span>
      </div>
      <label className="row">
        <input type="checkbox" checked={railExpanded} onChange={toggleRail} /> Show navigation labels (Ctrl \)
      </label>
      <Callout>
        Motion follows your operating system’s “reduce motion” setting: animations and transitions are shortened to near zero when it
        is on.
      </Callout>
    </div>
  );
}

export function SettingsPage() {
  const { section = 'appearance' } = useParams();
  const tab = TABS.find(([id]) => id === section);
  if (!tab) return <Navigate to="/app/settings/appearance" replace />;
  const [, label, gate] = tab;
  return (
    <Panes
      columns="230px minmax(0, 1fr)"
      contextLabel="Settings sections"
      context={
        <nav aria-label="Settings sections">
          <ul className="tree">
            {TABS.map(([id, l]) => (
              <li key={id}>
                <NavLink to={`/app/settings/${id}`} className="tnode" aria-current={id === section ? 'true' : undefined}>
                  {l}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      <div className="page">
        <p className="eyebrow">Settings</p>
        <h1 style={{ marginBottom: 20 }}>{label}</h1>
        {gate ? <p className="lede">These settings arrive with Gate {gate}.</p> : <Appearance />}
      </div>
    </Panes>
  );
}
