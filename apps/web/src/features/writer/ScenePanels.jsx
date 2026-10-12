import { useState } from 'react';
import { Link } from 'react-router';
import { relativeTime } from '@/features/knowledge/files.js';
import { Badge, Button, Callout, DemoBadge, Field, Input, Segmented, Select, Skeleton, StatusBadge, Textarea } from '@/shared/ui/index.js';
import { squash } from './doc.js';
import { TERMINAL_RUN, useRevision } from './queries.js';
import { DocDiff, WordDiff } from './WordDiff.jsx';

export const MODES = [
  { value: 'rewrite', label: 'Rewrite' },
  { value: 'shorten', label: 'Tighten' },
  { value: 'expand', label: 'Expand' },
  { value: 'tone', label: 'Change tone' },
  { value: 'dialogue', label: 'Improve dialogue' },
  { value: 'continue', label: 'Continue the scene' },
];
export const TONES = ['darker', 'warmer', 'tenser', 'wry', 'formal', 'lyrical'];
const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.value, m.label]));
const ACTIVE = new Set(['PENDING', 'STALE']);
const ORIGIN_LABEL = { AUTHOR: 'Author', POST_AI: 'Accepted AI', RESTORE: 'Restore', UNDO: 'Undo' };

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Suggestions tab: request rewrites for the current paragraph or the whole scene, then review each one as a
 * word diff. Nothing changes in the text until the author accepts.
 */
export function SuggestionsPanel({ suggestions, loading, blockText, blockLabel, getCurrentBlock, editable, onRequest, onAccept, onReject, onUnreject, onUndo, onJump }) {
  const [mode, setMode] = useState('rewrite');
  const [tone, setTone] = useState('darker');
  const [instruction, setInstruction] = useState('');
  const [hint, setHint] = useState('');
  const active = suggestions.filter((s) => ACTIVE.has(s.state) || s.run?.status === 'BUDGET_REJECTED');
  const earlier = suggestions.filter((s) => !active.includes(s));
  const body = (extra) => ({ mode, ...(mode === 'tone' ? { tone } : {}), ...(instruction.trim() ? { instruction: instruction.trim() } : {}), ...extra });

  return (
    <div className="side-body">
      {editable && (
        <section aria-labelledby="sg-req" className="stack" style={{ gap: 8 }}>
          <h3 className="sect-h" id="sg-req">
            Ask for a revision
          </h3>
          <Field label="Kind of revision">
            <Select value={mode} onChange={(e) => setMode(e.target.value)} options={MODES} />
          </Field>
          {mode === 'tone' && (
            <Field label="Tone">
              <Select value={tone} onChange={(e) => setTone(e.target.value)} options={TONES.map((t) => ({ value: t, label: t }))} />
            </Field>
          )}
          <Field label="Instruction (optional)">
            <Textarea rows={2} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. keep the narrator’s voice" />
          </Field>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button
              variant="ai"
              size="sm"
              onClick={() => {
                const b = getCurrentBlock();
                if (b?.text.trim()) onRequest(body({ blockIds: [b.blockId] }));
                else setHint('Place the cursor in a paragraph with text first.');
              }}
            >
              Revise current paragraph
            </Button>
            <Button size="sm" onClick={() => onRequest(body({ all: true }))}>
              Revise whole scene
            </Button>
          </div>
          {hint && (
            <p role="alert" className="subtle" style={{ fontSize: 12 }}>
              {hint}
            </p>
          )}
          <p className="subtle" style={{ fontSize: 11.5 }}>
            One small (T0) run per paragraph. Canon facts about characters in the paragraph are sent as constraints.
          </p>
        </section>
      )}
      {loading ? (
        <Skeleton height={80} />
      ) : active.length === 0 ? (
        <div className="empty" style={{ padding: '12px 0' }}>
          <p style={{ font: 'italic 16px var(--fv-font-serif)', color: 'var(--fv-text)' }}>Nothing changes until you decide.</p>
          <p style={{ marginTop: 8 }}>Select text in the scene and open Folio Lens, or ask for a revision above.</p>
        </div>
      ) : (
        <ul className="stack" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }} aria-label="Open suggestions">
          {active.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              current={blockText(s.blockId)}
              label={blockLabel(s.blockId)}
              editable={editable}
              onAccept={onAccept}
              onReject={onReject}
              onRegenerate={() => onRequest({ mode: s.mode, ...(s.tone ? { tone: s.tone } : {}), blockIds: [s.blockId] })}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details>
          <summary className="sect-h">Earlier suggestions ({earlier.length})</summary>
          <ul className="list" style={{ marginTop: 6 }}>
            {earlier.map((s) => (
              <li key={s.id} className="li">
                <StatusBadge family="sugg" value={s.state} />
                <span className="subtle grow" style={{ fontSize: 12 }}>
                  {blockLabel(s.blockId)} · {MODE_LABEL[s.mode] ?? s.mode}
                </span>
                {editable && s.state === 'REJECTED' && (
                  <Button size="sm" variant="ghost" onClick={() => onUnreject(s)}>
                    Undo reject
                  </Button>
                )}
                {editable && s.state === 'ACCEPTED' && (
                  <Button size="sm" variant="ghost" onClick={() => onUndo(s)}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SuggestionCard({ s, current, label, editable, onAccept, onReject, onRegenerate, onJump }) {
  const [vi, setVi] = useState(0);
  const run = s.run;
  const working = run && !TERMINAL_RUN.has(run.status);
  const failed = run && ['FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED'].includes(run.status);
  const variants = s.variants ?? [];
  const changedLocally = s.state === 'PENDING' && current != null && squash(current) !== squash(s.baseText);
  const stale = s.state === 'STALE' || changedLocally;
  const v = variants[Math.min(vi, variants.length - 1)];

  return (
    <li className="card pad stack" style={{ gap: 10 }} aria-label={`Suggestion for ${label}`}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn sm ghost" onClick={() => onJump(s.blockId)}>
          {label}
        </button>
        <span className="subtle" style={{ fontSize: 12 }}>
          {MODE_LABEL[s.mode] ?? s.mode}
          {s.tone ? ` · ${s.tone}` : ''}
        </span>
        <span className="grow" />
        {run && !['SUCCEEDED', 'PARTIAL'].includes(run.status) && <StatusBadge family="run" value={run.status} />}
        <StatusBadge family="sugg" value={stale ? 'STALE' : s.state} />
        {s.isDemo && <DemoBadge />}
      </div>
      {s.instruction && <p style={{ fontSize: 12.5 }}>{s.instruction}</p>}
      {working ? (
        <Callout tone="ai">Generating against frozen revision r{s.baseRevision}, with canon constraints…</Callout>
      ) : failed ? (
        <>
          <Callout tone="bad" role="alert">
            {run.status === 'BUDGET_REJECTED' ? 'The budget limit was reached before any model call; nothing was charged.' : (run.error?.message ?? 'The revision run failed. No text was changed.')}
          </Callout>
          {editable && (
            <Button size="sm" onClick={onRegenerate}>
              Regenerate
            </Button>
          )}
        </>
      ) : stale ? (
        <>
          <Callout tone="warn">The paragraph changed after this suggestion was generated. Regenerate to apply it safely.</Callout>
          {editable && (
            <div className="row">
              <Button size="sm" onClick={onRegenerate}>
                Regenerate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onReject(s)}>
                Reject
              </Button>
            </div>
          )}
        </>
      ) : v ? (
        <>
          {variants.length > 1 && (
            <Segmented label="Alternatives" value={String(vi)} onChange={(x) => setVi(Number(x))} options={variants.map((_, i) => ({ value: String(i), label: `Version ${'ABC'[i]}` }))} />
          )}
          <div>
            <p className="eyebrow">Original → suggested</p>
            <WordDiff before={s.baseText} after={v.text} label="Changes from the original paragraph" />
          </div>
          {v.rationale && (
            <p className="subtle" style={{ fontSize: 12 }}>
              {v.rationale}
            </p>
          )}
          {s.fallback && <Callout tone="warn">The model reply could not be used, so this is a deterministic fallback.</Callout>}
          {editable && (
            <>
              <div className="row">
                <Button variant="primary" size="sm" onClick={() => onAccept(s, Math.min(vi, variants.length - 1))}>
                  Accept
                </Button>
                <Button size="sm" onClick={() => onReject(s)}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" onClick={onRegenerate}>
                  Regenerate
                </Button>
              </div>
              <p className="subtle" style={{ fontSize: 11.5 }}>
                Accepting saves a new revision marked as accepted AI text. You can undo it afterwards.
              </p>
            </>
          )}
        </>
      ) : (
        <p className="muted">The run finished without usable alternatives.</p>
      )}
    </li>
  );
}

/** Context tab: open continuity issues in this scene and the canon facts about who and what appears in it. */
export function ContextPanel({ issues, facts, sceneText, editable, checking, dnaHref, onCheck, onJump, onIssue }) {
  const low = sceneText.toLowerCase();
  const subjects = new Map();
  for (const f of facts.filter((x) => x.status === 'CANON' && low.includes(x.subject.toLowerCase()))) subjects.set(f.subject, [...(subjects.get(f.subject) ?? []), f]);
  return (
    <div className="side-body">
      <div className="row">
        <h3 className="sect-h grow">Continuity</h3>
        {editable && (
          <Button size="sm" onClick={onCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Check this scene'}
          </Button>
        )}
      </div>
      {issues.length === 0 ? (
        <p className="empty">No open continuity issues in this scene.</p>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }} aria-label="Continuity issues">
          {issues.map((i) => (
            <IssueCard key={i.id} issue={i} editable={editable} onJump={onJump} onIssue={onIssue} />
          ))}
        </ul>
      )}
      <section aria-labelledby="ctx-canon">
        <h3 className="sect-h" id="ctx-canon">
          Canon in this scene
        </h3>
        {subjects.size === 0 ? (
          <p className="empty">No approved canon facts mention anyone or anything in this scene yet.</p>
        ) : (
          [...subjects].map(([subject, list]) => (
            <div key={subject} className="li">
              <span className="avatar" aria-hidden="true">
                {subject
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <div className="grow">
                <b>{subject}</b>
                {list.map((f) => (
                  <p key={f.id} style={{ fontSize: 12, marginTop: 3 }}>
                    ■ {f.statement}
                  </p>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
      <Link className="btn" to={dnaHref}>
        Open Narrative DNA
      </Link>
    </div>
  );
}

/** One continuity issue with its paired anchors (scene passage and canon evidence). */
export function IssueCard({ issue: i, editable, onJump, onIssue, showScene = false }) {
  const sceneAnchor = (i.anchors ?? []).find((a) => a.role === 'scene');
  const canonAnchor = (i.anchors ?? []).find((a) => a.role === 'canon');
  return (
    <li className="card pad" style={{ borderColor: i.state === 'OPEN' ? 'var(--fv-warn)' : undefined }} aria-label={`Continuity issue: ${i.entity}, ${i.fact}`}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <b className="grow">
          {i.entity} · {i.fact}
        </b>
        <Badge tone={i.severity === 'HIGH' ? 'bad' : 'warn'} glyph="!">
          {i.severity === 'HIGH' ? 'High' : i.severity === 'LOW' ? 'Low' : 'Medium'}
        </Badge>
        {i.state !== 'OPEN' && <Badge tone={i.state === 'RESOLVED' ? 'ok' : 'neutral'}>{i.state === 'RESOLVED' ? 'Resolved' : 'Dismissed'}</Badge>}
        {i.isDemo && <DemoBadge />}
      </div>
      <p style={{ margin: '8px 0', fontSize: 13 }}>
        Canon says <b>{i.expected}</b>; {showScene && i.sceneTitle ? `“${i.sceneTitle}”` : 'this scene'} says <b>{i.found}</b>.
      </p>
      <ul className="list" style={{ fontSize: 12.5 }}>
        {sceneAnchor && (
          <li className="li">
            <StatusBadge family="anchor" value={sceneAnchor.state ?? 'EXACT'} />
            <span>
              {sceneAnchor.sceneTitle ?? 'Scene'} — “{clip(sceneAnchor.quote ?? i.quote, 140)}”
            </span>
          </li>
        )}
        {canonAnchor && (
          <li className="li">
            <StatusBadge family="dna" value="CANON" />
            <span>{canonAnchor.statement ?? `${i.entity}: ${i.fact} is ${i.expected}`}</span>
          </li>
        )}
      </ul>
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {sceneAnchor?.state !== 'ORPHANED' && (
          <Button size="sm" onClick={() => onJump(i)}>
            Show in text
          </Button>
        )}
        {editable &&
          (i.state === 'OPEN' ? (
            <>
              <Button size="sm" variant="primary" onClick={() => onIssue(i, 'RESOLVED')}>
                Mark resolved
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onIssue(i, 'DISMISSED')}>
                Dismiss
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onIssue(i, 'OPEN')}>
              Reopen
            </Button>
          ))}
      </div>
      <p className="subtle" style={{ fontSize: 11, marginTop: 8 }}>
        Checked against approved canon facts only. A dismissed issue stays dismissed unless the passage changes.
      </p>
    </li>
  );
}

/** Research tab: notes (free text or quoted excerpts with a source anchor) and footnote insertion. */
export function ResearchPanel({ notes, excerpts, loading, editable, onCreate, onDelete, onInsert }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const used = new Set(notes.map((n) => n.excerptId).filter(Boolean));
  const fresh = excerpts.filter((e) => !used.has(e.id));

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() && !text.trim()) return setError('Write a title or some text.');
    try {
      await onCreate({ title: title.trim() || undefined, body: text });
      setTitle('');
      setText('');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="side-body">
      <h3 className="sect-h">Research notes</h3>
      {loading ? (
        <Skeleton height={60} />
      ) : notes.length === 0 ? (
        <p className="empty">No research notes yet. Save excerpts from Folio Knowledge with Folio Lens, then add them here.</p>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }} aria-label="Research notes">
          {notes.map((n) => (
            <li key={n.id} className="card pad stack" style={{ gap: 6 }}>
              <b>{n.title}</b>
              {n.quote && <blockquote className="w-quote">“{n.quote}”</blockquote>}
              {n.body && <p style={{ fontSize: 13 }}>{n.body}</p>}
              {n.source?.sourceId && n.source?.projectId && (
                <Link className="subtle" style={{ fontSize: 12 }} to={`/app/knowledge/projects/${n.source.projectId}/documents/${n.source.sourceId}`}>
                  Source: {n.source.title}
                  {n.source.anchor?.selectors?.page ? `, p. ${n.source.anchor.selectors.page}` : ''}
                </Link>
              )}
              {editable && (
                <div className="row">
                  <Button size="sm" onClick={() => onInsert(n)}>
                    Insert as footnote
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(n)}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && fresh.length > 0 && (
        <section aria-labelledby="rs-ex">
          <h3 className="sect-h" id="rs-ex">
            Saved excerpts
          </h3>
          <ul className="list">
            {fresh.slice(0, 20).map((e) => (
              <li key={e.id} className="li">
                <span className="grow" style={{ fontSize: 12.5 }}>
                  “{clip(e.quote, 110)}” <span className="subtle">— {e.title}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => onCreate({ excerptId: e.id })}>
                  Add to notes
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editable && (
        <form onSubmit={submit} className="stack" style={{ gap: 8 }} aria-label="New research note">
          <h3 className="sect-h">New note</h3>
          <Field label="Title">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Note" error={error || undefined}>
            <Textarea rows={3} value={text} maxLength={10000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button size="sm" type="submit">
            Add note
          </Button>
        </form>
      )}
    </div>
  );
}

/** History tab: revisions of this scene; pick one to compare with the current text and restore it. */
export function HistoryPanel({ wid, manuscriptId, nodeId, revisions, loading, currentRevision, getContent, editable, onRestore }) {
  const [picked, setPicked] = useState(/** @type {number | null} */ (null));
  const rev = useRevision(wid, manuscriptId, nodeId, picked);
  return (
    <div className="side-body">
      <h3 className="sect-h">Revisions</h3>
      {loading ? (
        <Skeleton height={60} />
      ) : !revisions.length ? (
        <p className="empty">No saved revisions yet.</p>
      ) : (
        <ul className="list" aria-label="Revisions">
          {revisions.map((r) => (
            <li key={r.id} className="li">
              <button type="button" className="tnode" aria-pressed={picked === r.revision} onClick={() => setPicked(picked === r.revision ? null : r.revision)}>
                <span className="mono">r{r.revision}</span>
                <Badge tone={r.origin === 'POST_AI' ? 'ai' : 'neutral'}>{ORIGIN_LABEL[r.origin] ?? r.origin}</Badge>
                <span className="subtle grow" style={{ fontSize: 12 }}>
                  {r.wordCount.toLocaleString()} words · {relativeTime(r.updatedAt ?? r.createdAt)}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked != null && (
        <section aria-labelledby="hist-cmp">
          <h3 className="sect-h" id="hist-cmp">
            r{picked} → current text
          </h3>
          {rev.isPending ? (
            <Skeleton height={60} />
          ) : rev.data ? (
            <>
              <DocDiff before={rev.data.content} after={getContent()} empty="Identical to the current text." />
              {editable && picked !== currentRevision && (
                <Button size="sm" style={{ marginTop: 8 }} onClick={() => onRestore(rev.data)}>
                  Restore r{picked}
                </Button>
              )}
            </>
          ) : (
            <Callout tone="bad">That revision could not be loaded.</Callout>
          )}
        </section>
      )}
    </div>
  );
}
