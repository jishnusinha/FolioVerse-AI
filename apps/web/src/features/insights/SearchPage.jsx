import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { Callout, Skeleton } from '@/shared/ui/index.js';
import { KIND_LABEL } from './labels.js';
import { useSearch } from './queries.js';
import { SEARCH_GROUPS, searchHref, useDebouncedValue } from './search.js';

/** Workspace-wide search: keyword matches across projects, documents, artifacts, notes and conversations, plus semantic passages. */
export function SearchPage() {
  const workspace = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const term = useDebouncedValue(q, 250);
  const results = useSearch(workspace?.id, term);
  const inputId = useId();

  const items = results.data?.items ?? [];
  const semantic = results.data?.semantic;
  return (
    <div className="page">
      <h1>Search</h1>
      <form
        className="row"
        role="search"
        style={{ margin: '14px 0 20px' }}
        onSubmit={(e) => {
          e.preventDefault();
          setParams(q.trim() ? { q: q.trim() } : {}, { replace: true });
        }}
      >
        <label className="sr" htmlFor={inputId}>
          Search this workspace
        </label>
        <input
          id={inputId}
          className="input grow"
          type="search"
          placeholder="Search documents, passages, artifacts, notes…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value.trim() ? { q: e.target.value.trim() } : {}, { replace: true });
          }}
        />
      </form>
      {term.trim().length < 2 ? (
        <p className="empty">Type at least two characters to search this workspace.</p>
      ) : results.isPending ? (
        <Skeleton height={120} />
      ) : results.error ? (
        <Callout tone="bad">Search failed: {results.error.message}</Callout>
      ) : (
        <div aria-live="polite" aria-busy={results.isFetching}>
          {semantic?.status === 'UNAVAILABLE' && (
            <Callout tone="warn">Semantic passage search is unavailable right now. Keyword results are still shown.</Callout>
          )}
          {!items.length && <p className="empty">Nothing matched “{term.trim()}”.</p>}
          {SEARCH_GROUPS.map(([type, label]) => {
            const group = items.filter((it) => it.type === type);
            if (!group.length) return null;
            return (
              <section key={type} className="search-group" aria-label={label}>
                <h2 className="sect-h">
                  {label} <span className="subtle mono">{group.length}</span>
                </h2>
                <ul className="list">
                  {group.map((it) => (
                    <li key={`${it.type}-${it.id}`} className="li search-hit">
                      <span className="grow">
                        <Link to={searchHref(it)}>{it.title}</Link>
                        {it.kind && <span className="subtle"> · {KIND_LABEL[it.kind] ?? it.kind}</span>}
                        {it.page ? <span className="subtle"> · p. {it.page}</span> : null}
                        {it.snippet && (
                          <span className="muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                            {it.snippet.length > 240 ? `${it.snippet.slice(0, 239)}…` : it.snippet}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
