import { useParams } from 'react-router';

/** Stand-in for a route whose real page lands in a later gate. */
export function PlaceholderPage({ route }) {
  const params = useParams();
  const entries = Object.entries(params).filter(([k]) => k !== '*');
  return (
    <section className="mx-auto max-w-[var(--fv-content-max)] p-8" aria-labelledby="page-title">
      <h1 id="page-title" className="font-serif text-[length:var(--fv-fs-2xl)] text-fv-text">
        {route.title}
      </h1>
      <p className="mt-2 text-fv-muted">
        Placeholder page. Implementation is scheduled for Gate {route.gate}.
      </p>
      {entries.length > 0 && (
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-[length:var(--fv-fs-sm)]">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fv-subtle">{k}</dt>
              <dd className="text-fv-text">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="p-8">
      <h1 className="font-serif text-[length:var(--fv-fs-2xl)]">Not found</h1>
      <p className="mt-2 text-fv-muted">This page does not exist or you do not have access to it.</p>
    </section>
  );
}
