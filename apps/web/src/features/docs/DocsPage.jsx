import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { Badge } from '@/shared/StatusBadge.jsx';
import { Callout, Skeleton } from '@/shared/ui/misc.jsx';
import { DOC_SECTIONS, outline, siteHref } from './catalog.js';
import { docHref, loadDocs } from './content.js';
import { Markdown } from './Markdown.jsx';

const REPO_URL = String(import.meta.env.VITE_REPO_URL || '').replace(/\/+$/, '');
const TONES = { implemented: 'ok', planned: 'info', demo: 'warn', blocked: 'bad' };

/** Documentation site pages that are generated from code rather than written as guides. */
const SITE_LINKS = [
  ['/docs/reference/api/', 'API reference'],
  ['/docs/reference/ai-service/', 'AI service API'],
  ['/docs/reference/data-model/', 'Data model'],
  ['/docs/runbooks/', 'Runbooks'],
  ['/docs/project/status/', 'Implementation status'],
  ['/docs/project/decision-log/', 'Decision log'],
];

function StatusBadges({ badges }) {
  if (!badges.length) return null;
  return (
    <div className="doc-badges" aria-label="Status">
      {badges.map((b) => (
        <Badge key={b.kind + b.label} tone={TONES[b.kind]} title={b.detail}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

function StatusNotes({ page }) {
  const blocked = page.badges.filter((b) => b.kind === 'blocked');
  return (
    <>
      {page.demo && (
        <Callout tone="warn">
          <strong>DEMO data.</strong> {page.demo}
        </Callout>
      )}
      {blocked.length > 0 && (
        <Callout tone="bad">
          <strong>Needs external setup.</strong>
          <ul className="doc-blocked">
            {blocked.map((b) => (
              <li key={b.label}>
                {b.label.replace(/^Blocked: /, '')}: {b.detail}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </>
  );
}

function Nav({ pages, current }) {
  return (
    <nav aria-label="Documentation pages">
      {DOC_SECTIONS.map((section) => {
        const list = pages.filter((p) => p.section === section);
        if (!list.length) return null;
        return (
          <div key={section} className="doc-nav-group">
            <p className="eyebrow">{section}</p>
            <ul className="tree">
              {list.map((p) => (
                <li key={p.slug}>
                  <NavLink to={docHref(p)} className="tnode" aria-current={p.slug === current ? 'true' : undefined}>
                    {p.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="doc-nav-group">
        <p className="eyebrow">More</p>
        <ul className="tree">
          <li>
            <Link to="/app/docs/design" className="tnode">
              Component gallery
            </Link>
          </li>
          <li>
            <a href="/docs/" className="tnode">
              Documentation site
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}

/** Page picker for narrow screens, where the navigation column is hidden. */
function MobileNav({ pages, current }) {
  const navigate = useNavigate();
  return (
    <label className="doc-mobile-nav">
      <span className="eyebrow">Page</span>
      <select className="select" value={current ?? ''} onChange={(e) => navigate(e.target.value ? `/app/docs/${e.target.value}` : '/app/docs')}>
        <option value="">Overview</option>
        {DOC_SECTIONS.map((section) => (
          <optgroup key={section} label={section}>
            {pages
              .filter((p) => p.section === section)
              .map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function Overview({ pages }) {
  return (
    <>
      <p className="eyebrow">Help</p>
      <h1>Documentation</h1>
      <p className="lede">
        How to use and run FolioVerse. Each page shows whether what it describes is implemented, shows DEMO data or waits on an external
        account, read from the project’s implementation status file.
      </p>
      {DOC_SECTIONS.map((section) => {
        const list = pages.filter((p) => p.section === section);
        if (!list.length) return null;
        return (
          <section key={section} aria-labelledby={`docs-${section}`}>
            <h2 id={`docs-${section}`}>{section}</h2>
            <ul className="doc-cards">
              {list.map((p) => (
                <li key={p.slug}>
                  <Link to={docHref(p)}>{p.title}</Link>
                  {p.description && <p>{p.description}</p>}
                  <StatusBadges badges={p.badges} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="docs-site">
        <h2 id="docs-site">Reference on the documentation site</h2>
        <p>Generated from the code on every build: the HTTP APIs, the database schema, the runbooks and the project records.</p>
        <ul>
          {SITE_LINKS.map(([href, label]) => (
            <li key={href}>
              <a href={href}>{label}</a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Article({ page, pages, images }) {
  const ctx = { fromFile: page.path, pages, pageHref: docHref, repoUrl: REPO_URL, images };
  return (
    <>
      <p className="eyebrow">{page.section}</p>
      <h1>{page.title}</h1>
      {page.description && <p className="lede">{page.description}</p>}
      <StatusBadges badges={page.badges} />
      <StatusNotes page={page} />
      <Markdown body={page.body} ctx={ctx} />
      <p className="doc-footer">
        Also on the <a href={siteHref(page)}>documentation site</a>, with search. Source: <code>{page.path}</code>
      </p>
    </>
  );
}

/** In-app help: /app/docs (overview) and /app/docs/:slug (one guide page). */
export function DocsPage() {
  const { slug } = useParams();
  const { data, error, isPending } = useQuery({ queryKey: ['docs-content'], queryFn: loadDocs, staleTime: Infinity });
  const page = slug ? data?.pages.find((p) => p.slug === slug) : null;

  let main;
  if (isPending) {
    main = (
      <div aria-busy="true" aria-label="Loading documentation">
        <Skeleton width="40%" height={28} />
        <Skeleton height={14} />
        <Skeleton height={14} width="80%" />
      </div>
    );
  } else if (error) {
    main = (
      <>
        <h1>Documentation</h1>
        <Callout tone="bad" role="alert">
          The documentation could not be loaded: {error.message}
        </Callout>
      </>
    );
  } else if (slug && !page) {
    main = (
      <>
        <h1>Page not found</h1>
        <p className="lede">
          There is no documentation page called “{slug}”. <Link to="/app/docs">See all pages</Link>.
        </p>
      </>
    );
  } else if (page) {
    main = <Article page={page} pages={data.pages} images={data.images} />;
  } else {
    main = <Overview pages={data.pages} />;
  }

  const toc = page ? outline(page.body) : [];
  return (
    <div className="panes docs-panes">
      <aside className="ctx" aria-label="Documentation navigation">
        {data && <Nav pages={data.pages} current={slug} />}
      </aside>
      <div className="pane">
        <article className="article">
          {data && <MobileNav pages={data.pages} current={page?.slug} />}
          {main}
        </article>
      </div>
      <aside className="toc" aria-label="On this page">
        {toc.length > 0 && (
          <>
            <p className="eyebrow">On this page</p>
            {toc.map((h) => (
              <a key={h.id} href={`#${h.id}`}>
                {h.text}
              </a>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
