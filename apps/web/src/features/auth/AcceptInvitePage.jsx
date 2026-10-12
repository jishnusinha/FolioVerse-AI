import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Callout } from '@/shared/ui/index.js';
import { AuthLayout } from './AuthLayout.jsx';
import { RequireSession } from './RequireSession.jsx';
import { ME_KEY, useWorkspaceStore } from './session.js';

function Accept() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: () => api('/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: async ({ workspaceId }) => {
      useWorkspaceStore.getState().setWorkspaceId(workspaceId);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/app/knowledge', { replace: true });
    },
  });
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    accept.mutate();
  }, [token, accept]);

  return (
    <AuthLayout>
      <h1>Join a workspace</h1>
      {accept.isError || !token ? (
        <>
          <Callout tone="bad" role="alert">
            This invitation is invalid, expired, already used, or addressed to a different email than the one you signed in with.
          </Callout>
          <Link to="/app">Go to your workspace</Link>
        </>
      ) : (
        <p className="muted" role="status">
          Accepting your invitation…
        </p>
      )}
    </AuthLayout>
  );
}

export function AcceptInvitePage() {
  return (
    <RequireSession>
      <Accept />
    </RequireSession>
  );
}
