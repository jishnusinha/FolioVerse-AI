import { Navigate, useLocation } from 'react-router';
import { Button, Callout, Skeleton } from '@/shared/ui/index.js';
import { useMe } from './session.js';

/** Renders children once `/auth/me` succeeds; signed-out visitors go to sign-in and come back afterwards. */
export function RequireSession({ children }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="stack" style={{ padding: 32, gap: 12 }} aria-busy="true" aria-label="Loading your workspace">
        <Skeleton width="40%" height={22} />
        <Skeleton width="70%" />
        <Skeleton width="55%" />
      </div>
    );
  }
  if (me.error?.status === 401) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (me.error) {
    return (
      <div style={{ padding: 32, maxWidth: 520 }}>
        <Callout tone="bad" role="alert">
          FolioVerse could not load your account ({me.error.message}).
        </Callout>
        <Button style={{ marginTop: 12 }} onClick={() => me.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return children;
}
