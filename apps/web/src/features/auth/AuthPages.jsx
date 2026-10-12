import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ensureCsrf } from '@/api/client.js';
import { Button, Callout, Field, Input } from '@/shared/ui/index.js';
import { AuthLayout, authErrorMessage } from './AuthLayout.jsx';
import { register, safeNext, signIn, useMe } from './session.js';

const MIN_PASSWORD = 10;

function ErrorCallout({ error }) {
  const msg = authErrorMessage(error);
  return msg ? (
    <Callout tone="bad" role="alert">
      {msg}
    </Callout>
  ) : null;
}

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const me = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => signIn(qc, { email, password }),
    onSuccess: () => navigate(next, { replace: true }),
  });

  if (me.data && !m.isPending) return <Navigate to={next} replace />;

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="muted">Sign in to your FolioVerse workspace.</p>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorCallout error={m.error} />
        <div className="row between">
          <Link to="/auth/forgot-password">Forgot password?</Link>
          <Button type="submit" variant="primary" disabled={m.isPending}>
            {m.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
      <p className="subtle" style={{ fontSize: 12 }}>
        No account? <Link to={`/auth/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>Create one</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const m = useMutation({
    mutationFn: () => register(qc, { email, password, displayName: displayName.trim() }),
    onSuccess: () => navigate(params.get('next') ? safeNext(params.get('next')) : '/onboarding', { replace: true }),
  });

  return (
    <AuthLayout step={0} steps={3}>
      <h1>Create your account</h1>
      <p className="muted">You get a personal workspace with Knowledge, Writing and Library projects. Email verification is required.</p>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooShort) m.mutate();
        }}
      >
        <Field label="Name">
          <Input autoComplete="name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorCallout error={m.error} />
        <div className="row between">
          <Link to="/auth/login">I already have an account</Link>
          <Button type="submit" variant="primary" disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
    },
  });

  return (
    <AuthLayout>
      <h1>Reset your password</h1>
      {m.isSuccess ? (
        <>
          <Callout role="status">
            If an account exists for <b>{email}</b>, we sent a single-use reset link. It is valid for one hour.
          </Callout>
          <Link to="/auth/login">Back to sign in</Link>
        </>
      ) : (
        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <p className="muted">Enter your account email and we will send you a reset link.</p>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorCallout error={m.error} />
          <div className="row between">
            <Link to="/auth/login">Back to sign in</Link>
            <Button type="submit" variant="primary" disabled={m.isPending}>
              Send reset link
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const m = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
    },
  });

  return (
    <AuthLayout>
      <h1>Choose a new password</h1>
      {!token ? (
        <Callout tone="bad" role="alert">
          This reset link is incomplete. <Link to="/auth/forgot-password">Request a new link</Link>.
        </Callout>
      ) : m.isSuccess ? (
        <>
          <Callout role="status">Your password was changed and other sessions were signed out.</Callout>
          <Link className="btn primary" to="/auth/login">
            Sign in
          </Link>
        </>
      ) : (
        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch && !tooShort) m.mutate();
          }}
        >
          <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`} error={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
            <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {m.error?.code === 'BAD_TOKEN' ? (
            <Callout tone="bad" role="alert">
              This link is invalid, expired or already used. <Link to="/auth/forgot-password">Request a new link</Link>.
            </Callout>
          ) : (
            <ErrorCallout error={m.error} />
          )}
          <Button type="submit" variant="primary" disabled={m.isPending}>
            Set new password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const me = useMe();
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      await api('/auth/verify-email', { method: 'POST', body: { token } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  const resend = useMutation({ mutationFn: () => api('/auth/resend-verification', { method: 'POST' }) });
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    verify.mutate();
  }, [token, verify]);

  return (
    <AuthLayout>
      <h1>Verify your email</h1>
      {verify.isSuccess ? (
        <>
          <Callout role="status">Your email address is verified.</Callout>
          <Link className="btn primary" to="/app">
            Continue to FolioVerse
          </Link>
        </>
      ) : token && (verify.isPending || verify.isIdle) ? (
        <p className="muted" role="status">
          Checking your link…
        </p>
      ) : (
        <>
          <Callout tone="bad" role="alert">
            {token ? 'This verification link is invalid, expired or already used.' : 'This verification link is incomplete.'}
          </Callout>
          {me.data ? (
            resend.isSuccess ? (
              <Callout role="status">A new link was sent to {me.data.user.email}.</Callout>
            ) : (
              <Button onClick={() => resend.mutate()} disabled={resend.isPending}>
                Send a new verification link
              </Button>
            )
          ) : (
            <Link to="/auth/login?next=/onboarding">Sign in to request a new link</Link>
          )}
        </>
      )}
    </AuthLayout>
  );
}
