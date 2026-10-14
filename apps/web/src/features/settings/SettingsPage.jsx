import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureCsrf } from '@/api/client.js';
import { ME_KEY, can, useCurrentWorkspace, useMe } from '@/features/auth/session.js';
import { useThemeStore } from '@/stores/theme.js';
import { useUiStore } from '@/stores/ui.js';
import { Button, Callout, DemoBadge, Field, Input, Segmented, Select, Skeleton, StatusBadge, Table, toast } from '@/shared/ui/index.js';
import { Panes } from '@/shared/layout/Panes.jsx';
import { BudgetsSettings } from '@/features/costs/BudgetsSettings.jsx';

const TABS = [
  ['appearance', 'Appearance'],
  ['profile', 'Profile'],
  ['workspace', 'Workspace'],
  ['models', 'Models'],
  ['budgets', 'Budgets'],
  ['privacy', 'Privacy'],
  ['notifications', 'Notifications'],
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

function Profile() {
  const { data, isLoading } = useMe();
  const qc = useQueryClient();
  const user = data?.user;
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);

  // Sync if loaded later
  if (user && !displayName && user.displayName) {
    setDisplayName(user.displayName);
  }

  if (isLoading) return <Skeleton height={140} />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await ensureCsrf();
      await api('/auth/me', { method: 'PATCH', body: { displayName: displayName.trim() } });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast('Profile updated', 'ok');
    } catch (err) {
      toast(err.message || 'Could not update profile', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form stack" style={{ maxWidth: 440, gap: 16 }} onSubmit={handleSubmit}>
      <Field label="Email address" hint="Your email is used for sign-in and notifications.">
        <Input type="email" value={user?.email ?? ''} disabled readOnly />
      </Field>
      <Field label="Display name" hint="Visible to other members of your workspaces.">
        <Input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Ada Lovelace"
          required
        />
      </Field>
      <div className="row">
        <Button variant="primary" type="submit" disabled={saving || !displayName.trim()}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}

function WorkspaceSettings() {
  const ws = useCurrentWorkspace();
  const qc = useQueryClient();
  const isAdmin = can(ws, 'ADMIN');
  const [name, setName] = useState(ws?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EDITOR');
  const [inviting, setInviting] = useState(false);

  const membersQuery = useQuery({
    queryKey: ['workspace-members', ws?.id],
    queryFn: () => api(`/workspaces/${ws?.id}/members`),
    enabled: Boolean(ws?.id),
  });

  const handleRename = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await ensureCsrf();
      await api(`/workspaces/${ws?.id}`, { method: 'PATCH', body: { name: name.trim() } });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast('Workspace renamed', 'ok');
    } catch (err) {
      toast(err.message || 'Could not rename workspace', 'bad');
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await ensureCsrf();
      await api(`/workspaces/${ws?.id}/invitations`, {
        method: 'POST',
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setInviteEmail('');
      toast(`Invitation sent to ${inviteEmail}`, 'ok');
    } catch (err) {
      toast(err.message || 'Could not send invite', 'bad');
    } finally {
      setInviting(false);
    }
  };

  if (!ws) return <Callout tone="bad">No active workspace selected.</Callout>;

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 640 }}>
      <form className="form stack" style={{ gap: 16 }} onSubmit={handleRename}>
        <Field label="Workspace name">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            required
          />
        </Field>
        <div className="row" style={{ fontSize: 13, gap: 16 }}>
          <span className="subtle">Type: <b style={{ color: 'var(--fv-text)' }}>{ws.kind}</b></span>
          <span className="subtle">Your role: <b style={{ color: 'var(--fv-text)' }}>{ws.role}</b></span>
        </div>
        {isAdmin && (
          <div className="row">
            <Button variant="primary" type="submit" disabled={saving || !name.trim() || name === ws.name}>
              {saving ? 'Renaming…' : 'Rename workspace'}
            </Button>
          </div>
        )}
      </form>

      <div className="stack" style={{ gap: 12 }}>
        <h3 className="sect-h">Members ({membersQuery.data?.length ?? 0})</h3>
        {membersQuery.isLoading ? (
          <Skeleton height={120} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {(membersQuery.data ?? []).map((m) => (
                <tr key={m.userId}>
                  <td>
                    <b>{m.displayName}</b>
                    <br />
                    <span className="subtle">{m.email}</span>
                  </td>
                  <td>
                    <span className="badge">{m.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {isAdmin && (
        <form className="card pad stack" style={{ gap: 12 }} onSubmit={handleInvite}>
          <h4 style={{ margin: 0 }}>Invite new member</h4>
          <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <Field label="Email" style={{ flexGrow: 1 }}>
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Role" style={{ width: 130 }}>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="VIEWER">Viewer</option>
                <option value="EDITOR">Editor</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </Field>
            <Button variant="primary" type="submit" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ModelsSettings() {
  const { data: models, isLoading, error } = useQuery({
    queryKey: ['models-catalog'],
    queryFn: () => api('/models'),
  });

  if (isLoading) return <Skeleton height={200} />;
  if (error) return <Callout tone="bad">Failed to load models: {error.message}</Callout>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="subtle">
        Available foundation models and local mock endpoints configured for this workspace.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th>Context Window</th>
            <th>Max Output</th>
            <th>Price / 1M Tok</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(models ?? []).map((m) => (
            <tr key={m.id}>
              <td>
                <b>{m.displayName}</b> {m.isDefault && <span className="badge">Default</span>} {m.isDemo && <DemoBadge />}
                <br />
                <span className="mono subtle" style={{ fontSize: 11 }}>{m.model}</span>
              </td>
              <td>{m.provider}</td>
              <td className="mono">{m.contextWindow.toLocaleString()}</td>
              <td className="mono">{m.maxOutputTokens.toLocaleString()}</td>
              <td className="mono">
                {m.price ? (
                  <span>
                    ${m.price.inputPerMTok} / ${m.price.outputPerMTok}
                  </span>
                ) : (
                  <span className="subtle">Unpriced / Unavailable</span>
                )}
              </td>
              <td>
                <StatusBadge family="run" value={m.available ? 'SUCCEEDED' : 'FAILED'} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function PrivacySettings() {
  const { data } = useMe();
  const qc = useQueryClient();
  const prefs = (data?.user?.preferences ?? {});
  const [telemetry, setTelemetry] = useState(Boolean(prefs.telemetryOptIn));
  const [retention, setRetention] = useState(String(prefs.dataRetentionDays ?? '365'));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await ensureCsrf();
      await api('/auth/me', {
        method: 'PATCH',
        body: {
          preferences: {
            telemetryOptIn: telemetry,
            dataRetentionDays: retention === 'indefinite' ? 'indefinite' : Number(retention),
          },
        },
      });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast('Privacy settings saved', 'ok');
    } catch (err) {
      toast(err.message || 'Could not save privacy settings', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form stack" style={{ maxWidth: 520, gap: 16 }} onSubmit={handleSave}>
      <label className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <input
          type="checkbox"
          checked={telemetry}
          onChange={(e) => setTelemetry(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div>
          <b>Anonymous usage telemetry</b>
          <p className="subtle" style={{ margin: '2px 0 0' }}>
            Help improve FolioVerse by sending anonymous performance metrics and error traces. No prompt content or document text is ever transmitted.
          </p>
        </div>
      </label>

      <Field label="Data retention policy" hint="How long query history, runs, and temporary generation artifacts are retained.">
        <Select value={retention} onChange={(e) => setRetention(e.target.value)}>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">365 days (1 year)</option>
          <option value="indefinite">Keep indefinitely</option>
        </Select>
      </Field>

      <div className="row">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save privacy settings'}
        </Button>
      </div>
    </form>
  );
}

function NotificationsSettings() {
  const { data } = useMe();
  const qc = useQueryClient();
  const prefs = (data?.user?.preferences ?? {});
  const [budgetAlerts, setBudgetAlerts] = useState(prefs.notifyBudgetAlerts !== false);
  const [weeklyDigest, setWeeklyDigest] = useState(Boolean(prefs.notifyWeeklyDigest));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await ensureCsrf();
      await api('/auth/me', {
        method: 'PATCH',
        body: {
          preferences: {
            notifyBudgetAlerts: budgetAlerts,
            notifyWeeklyDigest: weeklyDigest,
          },
        },
      });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast('Notification preferences saved', 'ok');
    } catch (err) {
      toast(err.message || 'Could not save notification preferences', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form stack" style={{ maxWidth: 520, gap: 16 }} onSubmit={handleSave}>
      <label className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <input
          type="checkbox"
          checked={budgetAlerts}
          onChange={(e) => setBudgetAlerts(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div>
          <b>Budget threshold alerts</b>
          <p className="subtle" style={{ margin: '2px 0 0' }}>
            Receive an email alert when your workspace reaches 80% and 100% of its monthly spend budget.
          </p>
        </div>
      </label>

      <label className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <input
          type="checkbox"
          checked={weeklyDigest}
          onChange={(e) => setWeeklyDigest(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div>
          <b>Weekly reading &amp; workspace digest</b>
          <p className="subtle" style={{ margin: '2px 0 0' }}>
            A summary email of books finished, reading streaks, and workspace research activity.
          </p>
        </div>
      </label>

      <div className="row">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save notification preferences'}
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { section = 'appearance' } = useParams();
  const tab = TABS.find(([id]) => id === section);
  if (!tab) return <Navigate to="/app/settings/appearance" replace />;
  const [, label] = tab;

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
        {section === 'appearance' && <Appearance />}
        {section === 'profile' && <Profile />}
        {section === 'workspace' && <WorkspaceSettings />}
        {section === 'models' && <ModelsSettings />}
        {section === 'budgets' && <BudgetsSettings />}
        {section === 'privacy' && <PrivacySettings />}
        {section === 'notifications' && <NotificationsSettings />}
      </div>
    </Panes>
  );
}
