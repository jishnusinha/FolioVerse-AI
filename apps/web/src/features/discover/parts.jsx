import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { CitedText } from '@/features/runs/CitedText.jsx';
import { visibleText } from '@/features/runs/runState.js';
import { useRunEvents } from '@/features/runs/useRunEvents.js';
import { Badge, Button, Callout, DemoBadge, DropdownMenu, Empty, Progress, Sheet, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { Icon } from '@/shared/icons.jsx';
import { discoverApi, factorBars, saveLabel, useSimilar } from './queries.js';

const KIND_LABEL = { BOOK: 'Book', FILM: 'Film' };
const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;

export function DiscoverHeader({ lab = false, action }) {
  return (
    <>
      <header className="row between" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
        <div>
          <p className="eyebrow">Discover · books & films</p>
          <h1 style={{ font: '500 30px var(--fv-font-serif)' }}>{lab ? 'Recommendation Lab' : 'Find your next story'}</h1>
        </div>
        <div className="row">
          {action}
          <DemoBadge />
        </div>
      </header>
      <nav className="tabs" aria-label="Discover sections" style={{ marginBottom: 20 }}>
        <NavLink to="/app/discover" end>
          Discover
        </NavLink>
        <NavLink to="/app/discover/recommendation-lab">Recommendation Lab</NavLink>
      </nav>
    </>
  );
}

/** Generated artwork in the item's cover tone: a spine pattern for books, a frame strip for films. */
export function RecArt({ item }) {
  const tone = item.coverTone || 1;
  const film = item.kind === 'FILM';
  return (
    <div className="art" aria-hidden="true" style={{ background: `var(--fv-cover-${tone})` }}>
      <svg viewBox="0 0 240 132" preserveAspectRatio="none">
        {film
          ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => <rect key={k} x={8 + k * 30} y="8" width="18" height="10" rx="2" fill="currentColor" fillOpacity=".25" />)
          : [0, 1, 2, 3].map((k) => <path key={k} d={`M0 ${70 + k * 14} Q60 ${58 + k * 14} 120 ${70 + k * 14} T240 ${70 + k * 14}`} stroke="currentColor" strokeOpacity={0.4 - k * 0.08} fill="none" />)}
        <circle cx={40 + ((tone * 37) % 160)} cy={film ? 74 : 40} r={film ? 22 : 12} fill="none" stroke="currentColor" strokeOpacity=".5" />
      </svg>
    </div>
  );
}

/** One recommendation card (prototype `.rec`). `rec` is a logged set item `{ rank, rationale, item, ... }`. */
export function RecCard({ rec, onWhy, onFeedback }) {
  const { item } = rec;
  const id = `rt-${item.id}`;
  return (
    <article className="rec" aria-labelledby={id}>
      <RecArt item={item} />
      <div className="body">
        <div className="row between">
          <span className="badge">{KIND_LABEL[item.kind]}</span>
          <span className="mono subtle">{item.year ?? ''}</span>
        </div>
        <h3 id={id} style={{ font: '500 17px var(--fv-font-serif)' }}>
          {item.title}
        </h3>
        <p className="subtle" style={{ fontSize: 12 }}>
          {item.creators.join(', ')}
        </p>
        <div className="row" style={{ gap: 4 }}>
          {item.themes.slice(0, 3).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--fv-muted)' }}>{rec.rationale}</p>
        <div className="row" style={{ marginTop: 'auto', flexWrap: 'nowrap' }}>
          <button type="button" className="btn sm ai" onClick={() => onWhy(rec)}>
            Why this?
          </button>
          <button type="button" className="btn sm" aria-pressed={item.feedback.saved} onClick={() => onFeedback(rec, item.feedback.saved ? 'UNSAVE' : 'SAVE')}>
            {saveLabel(item)}
          </button>
          <span className="grow" />
          <DropdownMenu
            trigger={
              <button type="button" className="icon-btn" aria-label={`More for ${item.title}`}>
                <Icon name="more" size={16} />
              </button>
            }
            items={[
              { label: item.feedback.rating === 1 ? 'Remove like' : 'More like this', onSelect: () => onFeedback(rec, item.feedback.rating === 1 ? 'CLEAR_RATING' : 'LIKE') },
              { label: item.feedback.rating === -1 ? 'Remove dislike' : 'Less like this', onSelect: () => onFeedback(rec, item.feedback.rating === -1 ? 'CLEAR_RATING' : 'DISLIKE') },
              '-',
              { label: 'Not interested', danger: true, onSelect: () => onFeedback(rec, 'DISMISS') },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

function ExplainBlock({ wid, run }) {
  const state = useRunEvents(wid, run.runId);
  const text = visibleText(state);
  return (
    <section className="ai-block" aria-label="Explanation in words" aria-live="polite">
      <div className="row between">
        <span className="ai-tag">◆ In words</span>
        <div className="row">
          {run.model?.provider === 'mock' && <DemoBadge />}
          <StatusBadge family="run" value={state.status} />
        </div>
      </div>
      {state.status === 'BUDGET_REJECTED' || state.error ? (
        <Callout tone="bad">{state.error?.message ?? 'The budget limit was reached before any model call. Nothing was charged.'}</Callout>
      ) : text ? (
        <div style={{ lineHeight: 1.6, marginTop: 8 }}>
          <CitedText text={text} citations={state.citations ?? {}} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 6, marginTop: 8 }} aria-busy="true">
          <Skeleton width="90%" />
          <Skeleton width="70%" />
        </div>
      )}
      {state.done && (
        <Link className="subtle" style={{ fontSize: 12 }} to={`/app/studio/runs/${run.runId}`}>
          Open run in Studio
        </Link>
      )}
    </section>
  );
}

/** "Why this?" drawer: the logged factor values, adjustments, shared themes, the anchor title and related titles in the other medium. */
export function WhyDrawer({ setId, rec, onClose, onFeedback }) {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const [run, setRun] = useState(null);
  const [asking, setAsking] = useState(false);
  const related = useSimilar(wid, rec?.item.id, true);
  if (!rec) return null;
  const { item } = rec;
  const bars = factorBars(rec);
  const other = item.kind === 'BOOK' ? 'films' : 'books';
  const explain = async () => {
    setAsking(true);
    try {
      setRun(await discoverApi.explain(wid, setId, item.id));
    } catch (e) {
      toast(e.message || 'The explanation could not be started', 'bad');
    } finally {
      setAsking(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Why this?" label={`Why “${item.title}” was recommended`}>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <p className="eyebrow">
            {KIND_LABEL[item.kind]} · {item.year} {item.isDemo && <DemoBadge />}
          </p>
          <h2 style={{ font: '500 22px var(--fv-font-serif)', margin: '4px 0' }}>{item.title}</h2>
          <p className="muted">{item.creators.join(', ')}</p>
          <p style={{ marginTop: 10 }}>{rec.rationale}</p>
          <p className="subtle mono" style={{ fontSize: 12, marginTop: 6 }}>
            score {rec.score.toFixed(3)} · ranked {ordinal(rec.rank)}
            {rec.baseRank !== rec.rank ? ` (${ordinal(rec.baseRank)} before diversification)` : ''}
          </p>
        </div>

        <section aria-labelledby="why-signals">
          <h3 className="sect-h" id="why-signals">
            Signals
          </h3>
          <ul className="stack" style={{ gap: 10, listStyle: 'none', padding: 0 }}>
            {bars.map((f) => (
              <li key={f.key}>
                <div className="row between" style={{ fontSize: 12.5 }}>
                  <span>{f.label}</span>
                  <span className="mono subtle">
                    {f.value.toFixed(2)} × {f.weight.toFixed(2)} = {signed(f.contribution)}
                  </span>
                </div>
                <Progress value={f.value * 100} label={`${f.label}: ${Math.round(f.value * 100)}%`} />
              </li>
            ))}
            {rec.adjustments.map((a) => (
              <li key={a.key} className="row between" style={{ fontSize: 12.5 }}>
                <span>{a.label}</span>
                <span className="mono" style={{ color: 'var(--fv-bad)' }}>
                  {signed(a.value)}
                </span>
              </li>
            ))}
          </ul>
          <p className="subtle" style={{ fontSize: 11.5, marginTop: 8 }}>
            Values are the recorded factor scores for this recommendation (0–1) times the weights in force when it was made.
          </p>
        </section>

        {(rec.sharedThemes.length > 0 || rec.becauseOf) && (
          <section aria-labelledby="why-themes">
            <h3 className="sect-h" id="why-themes">
              What connects it to you
            </h3>
            {rec.becauseOf && (
              <p style={{ fontSize: 13, marginBottom: 8 }}>
                {rec.becauseOf.kind === 'library' ? 'Close to a book in your Library: ' : 'Close to a title you liked or saved: '}
                <b>“{rec.becauseOf.title}”</b>
              </p>
            )}
            <div className="row" style={{ gap: 4 }}>
              {rec.sharedThemes.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="why-related">
          <h3 className="sect-h" id="why-related">
            Related {other}
          </h3>
          {related.isPending ? (
            <Skeleton height={60} />
          ) : related.error ? (
            <p className="subtle">Related titles are unavailable right now.</p>
          ) : !related.data?.length ? (
            <Empty>No close {other} in the catalog.</Empty>
          ) : (
            <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0 }}>
              {related.data.slice(0, 4).map((r) => (
                <li key={r.item.id} className="row between" style={{ fontSize: 13, flexWrap: 'nowrap' }}>
                  <span>
                    <b style={{ fontWeight: 550 }}>{r.item.title}</b> <span className="subtle">· {r.item.creators[0]}</span>
                  </span>
                  <Badge>{KIND_LABEL[r.item.kind]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="row">
          <Button variant="primary" onClick={() => onFeedback(rec, item.feedback.saved ? 'UNSAVE' : 'SAVE')}>
            {saveLabel(item)}
          </Button>
          <Button onClick={() => onFeedback(rec, item.feedback.rating === 1 ? 'CLEAR_RATING' : 'LIKE')} aria-pressed={item.feedback.rating === 1}>
            More like this
          </Button>
          <Button onClick={() => onFeedback(rec, 'DISMISS')}>Not interested</Button>
        </div>

        {run ? (
          <ExplainBlock wid={wid} run={run} />
        ) : (
          <div>
            <Button variant="ai" onClick={explain} disabled={asking || !can(ws, 'EDITOR')} title={can(ws, 'EDITOR') ? undefined : 'Needs the Editor role'}>
              <Icon name="lens" size={14} />
              {asking ? 'Starting…' : 'Explain in words'}
            </Button>
            <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
              A short model-written rationale from the recorded signals above only (rec_explain, T0). It is a separate, billed run.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Chips({ label, options, value, onChange, max }) {
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : max && value.length >= max ? value : [...value, o]);
  return (
    <div className="row" role="group" aria-label={label} style={{ gap: 6 }}>
      {options.map((o) => (
        <button key={o} type="button" className="chipbtn" aria-pressed={value.includes(o)} onClick={() => toggle(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
export { Chips };

/** First-run taste onboarding: genres, moods, themes and a few favourites from popular titles. */
export function TasteOnboarding({ taste, onSave, onSkip, saving }) {
  const p = taste.profile;
  const [genres, setGenres] = useState(p?.genres ?? []);
  const [moods, setMoods] = useState(p?.moods ?? []);
  const [themes, setThemes] = useState(p?.themes ?? []);
  const [seeds, setSeeds] = useState(p?.seedItemIds ?? []);
  const topThemes = [...taste.vocabulary.themes].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 18).map((t) => t.name);
  const toggleSeed = (id) => setSeeds((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 12 ? s : [...s, id]));
  return (
    <section className="card pad stack" aria-labelledby="taste-h" style={{ gap: 18, marginBottom: 24 }}>
      <div>
        <h2 id="taste-h" style={{ font: '500 22px var(--fv-font-serif)' }}>
          Tell us what you like
        </h2>
        <p className="muted">
          Pick a few of each. This stays private to you in this workspace and you can change it any time. Books you read in your Library and titles you save
          count too.
        </p>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Genres</p>
        <Chips label="Genres" options={taste.vocabulary.genres} value={genres} onChange={setGenres} max={8} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Moods</p>
        <Chips label="Moods" options={taste.vocabulary.moods} value={moods} onChange={setMoods} max={8} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Themes</p>
        <Chips label="Themes" options={topThemes} value={themes} onChange={setThemes} max={12} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Favourites · {seeds.length} picked</p>
        <div className="row" role="group" aria-label="Favourites" style={{ gap: 6 }}>
          {taste.seeds.map((s) => (
            <button key={s.id} type="button" className="chipbtn" aria-pressed={seeds.includes(s.id)} onClick={() => toggleSeed(s.id)} title={`${KIND_LABEL[s.kind]} · ${s.creators.join(', ')}`}>
              {s.title} <span className="subtle">· {KIND_LABEL[s.kind]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <Button variant="primary" disabled={saving} onClick={() => onSave({ genres, moods, themes, seedItemIds: seeds })}>
          {saving ? 'Saving…' : 'Save my taste'}
        </Button>
        {onSkip && (
          <Button onClick={onSkip} disabled={saving}>
            Skip for now
          </Button>
        )}
        <span className="subtle" style={{ fontSize: 12 }}>
          {taste.catalogSize} titles in the catalog · synthetic DEMO data
        </span>
      </div>
    </section>
  );
}
