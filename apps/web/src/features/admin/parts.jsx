import { NavLink } from 'react-router';
import { NotFoundPage } from '@/app/PlaceholderPage.jsx';
import { useMe } from '@/features/auth/session.js';
import { Skeleton } from '@/shared/ui/index.js';
import { useIsSuperAdmin } from './queries.js';

const TABS = [
  ['/app/admin/costs', 'Cost Command Center'],
  ['/app/admin/pricing', 'Model prices'],
  ['/app/admin/models', 'Model registry'],
];

/** Super-admin pages render as "not found" for everyone else, matching the API's 404. */
export function AdminFrame({ title, intro, actions, children }) {
  const me = useMe();
  const admin = useIsSuperAdmin();
  if (me.isPending) {
    return (
      <div className="page">
        <Skeleton height={120} />
      </div>
    );
  }
  if (!admin) return <NotFoundPage />;
  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <header className="row between" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <p className="eyebrow">Super Admin · Platform</p>
          <h1>{title}</h1>
          {intro && (
            <p className="muted" style={{ marginTop: 4, maxWidth: 760 }}>
              {intro}
            </p>
          )}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      <nav aria-label="Administration" className="row" style={{ marginBottom: 18 }}>
        {TABS.map(([to, label]) => (
          <NavLink key={to} to={to} className="btn sm ghost" style={({ isActive }) => (isActive ? { background: 'var(--fv-accent-soft)' } : undefined)}>
            {label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
