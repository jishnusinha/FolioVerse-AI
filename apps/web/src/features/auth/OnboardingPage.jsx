import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Button, Callout, Field, Input } from '@/shared/ui/index.js';
import { AuthLayout, authErrorMessage } from './AuthLayout.jsx';
import { ME_KEY, can, useCurrentWorkspace, useMe } from './session.js';
import { RequireSession } from './RequireSession.jsx';

function VerifyNotice({ user }) {
  const resend = useMutation({ mutationFn: () => api('/auth/resend-verification', { method: 'POST' }) });
  if (user.emailVerified) return null;
  return (
    <Callout role="status">
      We sent a verification link to <b>{user.email}</b>.{' '}
      {resend.isSuccess ? (
        'A new link is on its way.'
      ) : (
        <button type="button" className="linkish" onClick={() => resend.mutate()} disabled={resend.isPending}>
          Send it again
        </button>
      )}
    </Callout>
  );
}

function WorkspaceStep({ workspace, onDone }) {
  const qc = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const editable = can(workspace, 'ADMIN');
  const save = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}`, { method: 'PATCH', body: { name: name.trim() } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      onDone();
    },
  });
  return (
    <form
      className="stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!editable || name.trim() === workspace.name) onDone();
        else save.mutate();
      }}
    >
      <h1>Name your workspace</h1>
      <p className="muted">Workspaces hold projects, members and budgets. Your Library stays in your personal space.</p>
      <Field label="Workspace name">
        <Input required maxLength={80} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="subtle" style={{ fontSize: 12 }}>
        A default monthly AI budget is applied. Budgets and alerts are managed in Settings.
      </p>
      {save.error && (
        <Callout tone="bad" role="alert">
          {authErrorMessage(save.error)}
        </Callout>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function ProjectStep({ workspace, onBack }) {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ['projects', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/projects`),
  });
  const knowledge = projects.data?.find((p) => p.kind === 'KNOWLEDGE');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <h1>Start your first project</h1>
      <p className="muted">You can create the other kind at any time.</p>
      <div className="modes">
        <button
          type="button"
          className="mode"
          style={{ textAlign: 'left', cursor: 'pointer' }}
          disabled={projects.isPending}
          onClick={() => navigate(knowledge ? `/app/knowledge/projects/${knowledge.id}` : '/app/knowledge')}
        >
          <span className="eyebrow">Folio Knowledge</span>
          <h2>Research project</h2>
          <p className="muted">Upload documents and ask grounded questions.</p>
        </button>
        <button type="button" className="mode writer" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/app/writer')}>
          <span className="eyebrow">Folio Writer</span>
          <h2>Manuscript</h2>
          <p className="muted">Write with story memory and continuity checks.</p>
        </button>
      </div>
      <Button variant="ghost" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        Back
      </Button>
    </div>
  );
}

function Onboarding() {
  const me = useMe();
  const workspace = useCurrentWorkspace();
  const [step, setStep] = useState(1);
  return (
    <AuthLayout step={step} steps={3}>
      <VerifyNotice user={me.data.user} />
      {!workspace ? (
        <Callout tone="bad" role="alert">
          Your account has no workspace yet. Ask a workspace owner for an invitation.
        </Callout>
      ) : step === 1 ? (
        <WorkspaceStep workspace={workspace} onDone={() => setStep(2)} />
      ) : (
        <ProjectStep workspace={workspace} onBack={() => setStep(1)} />
      )}
    </AuthLayout>
  );
}

export function OnboardingPage() {
  return (
    <RequireSession>
      <Onboarding />
    </RequireSession>
  );
}
