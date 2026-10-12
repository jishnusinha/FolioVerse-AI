import { Logo } from '@/shared/icons.jsx';

/** Two-column sign-in layout from the prototype `auth` view; the brand column hides on mobile. */
export function AuthLayout({ step, steps = 0, children, footer }) {
  return (
    <div className="auth">
      <section className="auth-brand" aria-hidden="true">
        <div className="brand" style={{ padding: 0 }}>
          <Logo />
          <span>
            FolioVerse <span className="ai-mark">AI</span>
          </span>
        </div>
        <svg viewBox="0 0 400 300" style={{ width: '100%', maxWidth: 440, color: 'var(--fv-ai-line)' }}>
          <g fill="none" stroke="currentColor">
            <circle cx="200" cy="150" r="120" strokeOpacity=".5" />
            <ellipse cx="200" cy="150" rx="170" ry="60" transform="rotate(-18 200 150)" strokeOpacity=".7" />
            <path d="M80 150h240M200 30v240" strokeOpacity=".25" />
          </g>
          <g fill="var(--fv-accent)">
            <circle cx="118" cy="110" r="4" />
            <circle cx="286" cy="182" r="4" />
            <circle cx="232" cy="66" r="3" />
          </g>
        </svg>
        <p className="lede" style={{ color: 'var(--fv-muted)' }}>
          An intelligent atlas for knowledge, writing, reading and discovery — with every AI step explained.
        </p>
      </section>
      <section className="auth-card">
        {steps > 0 && (
          <div className="steps" role="img" aria-label={`Step ${step + 1} of ${steps}`}>
            {Array.from({ length: steps }, (_, i) => (
              <i key={i} className={i <= step ? 'on' : undefined} />
            ))}
          </div>
        )}
        <div className="stack" style={{ gap: 14 }}>
          {children}
        </div>
        {footer && (
          <p className="subtle" style={{ fontSize: 12 }}>
            {footer}
          </p>
        )}
      </section>
    </div>
  );
}

/** Problem+json message for a failed auth request, with friendlier copy for common codes. */
export function authErrorMessage(err) {
  if (!err) return null;
  if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (!err.status) return 'Could not reach FolioVerse. Check your connection and try again.';
  return err.message || 'Something went wrong. Try again.';
}
