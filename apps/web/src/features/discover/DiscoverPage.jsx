import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { libraryKeys } from '@/features/library/queries.js';
import { Button, Callout, Empty, Input, Segmented, Skeleton, toast } from '@/shared/ui/index.js';
import { Chips, DiscoverHeader, RecArt, RecCard, TasteOnboarding, WhyDrawer } from './parts.jsx';
import { discoverApi, discoverKeys, useLatestSet, useSaved, useTaste } from './queries.js';

const KINDS = [
  { value: '', label: 'Books & films' },
  { value: 'BOOK', label: 'Books' },
  { value: 'FILM', label: 'Films' },
];

/** Applies a feedback result to the matching item of a logged set (so the card updates without refetching). */
function withItem(set, item) {
  return set ? { ...set, items: set.items.map((r) => (r.itemId === item.id ? { ...r, item } : r)) } : set;
}

function SavedShelf({ items }) {
  if (!items?.length) return null;
  return (
    <section aria-labelledby="saved-h" style={{ marginTop: 32 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 className="sect-h" id="saved-h" style={{ margin: 0 }}>
          Saved · {items.length}
        </h2>
        {items.some((i) => i.feedback.libraryItemId) && (
          <Link className="subtle" to="/app/library" style={{ fontSize: 12 }}>
            Saved books are on your Library “To read” shelf
          </Link>
        )}
      </div>
      <div className="rec-grid" role="list" aria-label="Saved titles" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
        {items.slice(0, 12).map((i) => (
          <div key={i.id} role="listitem" className="rec">
            <RecArt item={i} />
            <div className="body" style={{ gap: 2 }}>
              <b style={{ font: '500 14px var(--fv-font-serif)' }}>{i.title}</b>
              <span className="subtle" style={{ fontSize: 11.5 }}>
                {i.kind === 'FILM' ? 'Film' : 'Book'} · {i.creators[0]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DiscoverPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const taste = useTaste(wid);
  const latest = useLatestSet(wid, 'DISCOVER');
  const saved = useSaved(wid);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [moods, setMoods] = useState([]);
  const [genres, setGenres] = useState([]);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [why, setWhy] = useState(null);
  const [editingTaste, setEditingTaste] = useState(false);
  const [savingTaste, setSavingTaste] = useState(false);
  const restored = useRef(false);
  const autoRan = useRef(false);

  const set = current ?? (latest.data?.id ? latest.data : null);
  const onboarding = editingTaste || (taste.data && !taste.data.profile);

  const discover = async (over = {}) => {
    const body = { query: over.query ?? query, kind: (over.kind ?? kind) || undefined, moods: over.moods ?? moods, genres: over.genres ?? genres, k: 12 };
    setBusy(true);
    setError(null);
    try {
      const res = await discoverApi.recommend(wid, body);
      setCurrent(res);
      qc.setQueryData(discoverKeys.latest(wid, 'DISCOVER'), res);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (restored.current || !latest.data) return;
    restored.current = true;
    const s = latest.data;
    if (!s.id) return;
    setQuery(s.query ?? '');
    setKind(s.filters?.kind ?? '');
    setMoods(s.filters?.moods ?? []);
    setGenres(s.filters?.genres ?? []);
  }, [latest.data]);

  const discoverRef = useRef(discover);
  discoverRef.current = discover;
  useEffect(() => {
    if (autoRan.current || !wid || !taste.data?.profile || !latest.data || latest.data.id) return;
    autoRan.current = true;
    discoverRef.current({});
  }, [wid, taste.data, latest.data]);

  const saveTaste = async (body) => {
    setSavingTaste(true);
    try {
      await discoverApi.saveTaste(wid, body);
      await qc.invalidateQueries({ queryKey: discoverKeys.taste(wid) });
      setEditingTaste(false);
      autoRan.current = true;
      await discover({});
    } catch (e) {
      toast(e.message || 'Your taste could not be saved', 'bad');
    } finally {
      setSavingTaste(false);
    }
  };

  const feedback = async (rec, action) => {
    try {
      const item = await discoverApi.feedback(wid, { itemId: rec.item.id, action, setId: set?.id, position: rec.rank });
      if (action === 'DISMISS') {
        setCurrent((s) => (s ? { ...s, items: s.items.filter((r) => r.itemId !== item.id) } : { ...set, items: set.items.filter((r) => r.itemId !== item.id) }));
        setWhy(null);
        toast(`“${item.title}” hidden. It will not be recommended again.`, 'ok');
      } else {
        setCurrent((s) => withItem(s ?? set, item));
        setWhy((w) => (w && w.itemId === item.id ? { ...w, item } : w));
        if (action === 'SAVE') toast(item.kind === 'BOOK' ? `“${item.title}” added to your Library · To read` : `“${item.title}” added to your watchlist`, 'ok');
        if (action === 'LIKE') toast('Noted. More like this next time.', 'ok');
        if (action === 'DISLIKE') toast('Noted. Less like this next time.', 'ok');
      }
      qc.invalidateQueries({ queryKey: discoverKeys.saved(wid) });
      if (action === 'SAVE' || action === 'UNSAVE') qc.invalidateQueries({ queryKey: libraryKeys.allItems(wid) });
    } catch (e) {
      toast(e.message || 'That did not work', 'bad');
    }
  };

  const openWhy = (rec) => {
    setWhy(rec);
    discoverApi.feedback(wid, { itemId: rec.item.id, action: 'CLICK', setId: set?.id, position: rec.rank }).catch(() => {});
  };

  const vocab = taste.data?.vocabulary;
  const unavailable = error?.status === 503 || latest.error?.status === 503;

  return (
    <div className="page">
      <DiscoverHeader
        action={
          taste.data?.profile &&
          !editingTaste && (
            <Button size="sm" onClick={() => setEditingTaste(true)}>
              Edit taste
            </Button>
          )
        }
      />

      {taste.isPending ? (
        <Skeleton height={200} />
      ) : taste.error ? (
        <Callout tone="bad" role="alert">
          Discover could not be loaded: {taste.error.message}
        </Callout>
      ) : taste.data.catalogSize === 0 ? (
        <Empty>The title catalog is empty. An administrator can load the DEMO catalog with the database seed (FV_DEMO_CATALOG=true).</Empty>
      ) : onboarding ? (
        <TasteOnboarding
          taste={taste.data}
          saving={savingTaste}
          onSave={saveTaste}
          onSkip={editingTaste ? () => setEditingTaste(false) : () => saveTaste({})}
        />
      ) : (
        <>
          <form
            className="row"
            style={{ marginBottom: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              discover({});
            }}
          >
            <label className="sr" htmlFor="dq">
              Describe what you want
            </label>
            <Input
              id="dq"
              style={{ maxWidth: 560, height: 40 }}
              placeholder="e.g. atmospheric science fiction about memory, and related films"
              value={query}
              maxLength={500}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button variant="primary" type="submit" style={{ height: 40 }} disabled={busy}>
              {busy ? 'Finding…' : 'Discover'}
            </Button>
          </form>
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            <Segmented
              label="Media type"
              value={kind}
              onChange={(v) => {
                setKind(v);
                discover({ kind: v });
              }}
              options={KINDS}
            />
            <span className="subtle" style={{ marginLeft: 8 }}>
              Mood
            </span>
            <Chips
              label="Mood"
              options={vocab.moods}
              value={moods}
              onChange={(v) => {
                setMoods(v);
                discover({ moods: v });
              }}
            />
            <span className="subtle" style={{ marginLeft: 8 }}>
              Genre
            </span>
            <Chips
              label="Genre"
              options={vocab.genres}
              value={genres}
              onChange={(v) => {
                setGenres(v);
                discover({ genres: v });
              }}
            />
          </div>

          {unavailable ? (
            <Callout tone="warn" role="alert">
              The recommender is not available right now. Your taste and saved titles are kept; try again in a moment.
            </Callout>
          ) : error ? (
            <Callout tone="bad" role="alert">
              Recommendations could not be loaded: {error.message}
            </Callout>
          ) : null}

          {latest.isPending || (busy && !set) ? (
            <div className="rec-grid" aria-busy="true">
              {[0, 1, 2, 3].map((k) => (
                <Skeleton key={k} height={300} />
              ))}
            </div>
          ) : set ? (
            <>
              <p className="subtle" style={{ fontSize: 12, marginBottom: 18 }} role="status">
                {set.items.length} results · ranked by meaning, word overlap, shared themes and your taste, then diversified (MMR λ = {set.lambda}) · {set.modelVersion}
                {set.coldStart ? ' · starting from well-rated titles until you save or rate a few' : ''}
              </p>
              {set.items.length ? (
                <div className="rec-grid" aria-busy={busy}>
                  {set.items.map((rec) => (
                    <RecCard key={rec.itemId} rec={rec} onWhy={openWhy} onFeedback={feedback} />
                  ))}
                </div>
              ) : (
                <Empty>
                  No titles match these filters.{' '}
                  <Button
                    size="sm"
                    onClick={() => {
                      setKind('');
                      setMoods([]);
                      setGenres([]);
                      discover({ kind: '', moods: [], genres: [] });
                    }}
                  >
                    Clear filters
                  </Button>
                </Empty>
              )}
            </>
          ) : (
            !error && <Empty>Describe what you are in the mood for, or press Discover for picks based on your taste.</Empty>
          )}

          <SavedShelf items={saved.data} />
        </>
      )}

      {why && set && <WhyDrawer setId={set.id} rec={set.items.find((r) => r.itemId === why.itemId) ?? why} onClose={() => setWhy(null)} onFeedback={feedback} />}
    </div>
  );
}
