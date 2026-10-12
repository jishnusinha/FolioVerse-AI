import { useParams } from 'react-router';

/** Stand-in for a route whose real page lands in a later gate. */
export function PlaceholderPage({ route }) {
  const params = useParams();
  const entries = Object.entries(params).filter(([k]) => k !== '*');
  return (
    <section className="page" aria-labelledby="page-title">
      <header className="home-head">
        <div>
          <p className="eyebrow">Gate {route.gate}</p>
          <h1 id="page-title">{route.title}</h1>
          <p className="lede">This screen is scheduled for Gate {route.gate}. The shell, navigation and overlays are live.</p>
        </div>
      </header>
      {entries.length > 0 && (
        <dl className="kv">
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="page">
      <h1>Not found</h1>
      <p className="lede">This page does not exist or you do not have access to it.</p>
    </section>
  );
}
