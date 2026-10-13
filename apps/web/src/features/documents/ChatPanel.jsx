import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { formatUsd } from '@/shared/format.js';
import { DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { EvidenceDrawer } from '@/shared/overlays/EvidenceDrawer.jsx';
import { ModelSelector } from '@/shared/overlays/ModelSelector.jsx';
import { RunReceipt } from '@/shared/overlays/RunReceipt.jsx';
import { Button, Callout, Skeleton } from '@/shared/ui/index.js';
import { budgetScopeText } from '../costs/queries.js';
import { CitedText } from '../runs/CitedText.jsx';
import { runKeys, useModels, useReceipt, useThread, useThreads } from '../runs/queries.js';
import { useRunEvents } from '../runs/useRunEvents.js';
import { visibleText } from '../runs/runState.js';
import { branches, latestLeaf, messageOutcome, pathTo, preflightEstimate } from './conversation.js';
import { BranchCompareDialog, ScopeBar, ThreadMenu } from './ConversationTools.jsx';

/**
 * Grounded conversation about one document version.
 * @param {{ wid: string, source: any, version: any, projectId: string, canAsk: boolean, canEdit: boolean, blockedReason?: string | null,
 *   projectName?: string, onOpenCitation: (citation: any) => void, request?: { kind: 'ask' | 'prefill', text: string, at: number } | null }} props
 */
export function ChatPanel({ wid, source, version, projectId, canAsk, canEdit, blockedReason, projectName, onOpenCitation, request }) {
  const qc = useQueryClient();
  const threads = useThreads(wid, source.id);
  const [threadId, setThreadId] = useState(/** @type {string | null} */ (null));
  const [leafId, setLeafId] = useState(/** @type {string | null} */ (null));
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState('auto');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(/** @type {any} */ (null));
  const [evidence, setEvidence] = useState(/** @type {any} */ (null));
  const [extraScope, setExtraScope] = useState(/** @type {any[]} */ ([]));
  const [comparing, setComparing] = useState(false);
  const models = useModels();
  const scrollRef = useRef(null);
  const composerRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const askId = useId();

  const list = useMemo(() => threads.data ?? [], [threads.data]);
  useEffect(() => {
    if (threadId === null && list.length) setThreadId(list[0].id);
  }, [list, threadId]);
  const activeThreadId = threadId && threadId !== 'new' ? threadId : null;
  const thread = useThread(wid, activeThreadId);
  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const leaf = leafId && messages.some((m) => m.id === leafId) ? leafId : latestLeaf(messages);
  const path = leaf ? pathTo(messages, leaf) : [];
  const branchList = branches(messages);

  const options = (models.data ?? [])
    .filter((m) => m.available !== false && m.status !== 'DISABLED')
    .map((m) => ({ id: m.id, label: m.displayName, provider: m.provider, isDemo: m.isDemo, priced: Boolean(m.price) }));
  const chosen = (models.data ?? []).find((m) => (model === 'auto' ? m.isDefault : m.id === model)) ?? (models.data ?? [])[0];
  const estimate = preflightEstimate(chosen, question);
  const versionLabel = (svid) => source.versions?.find((v) => v.id === svid)?.versionNo;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [path.length, leaf]);

  const refresh = (tid = activeThreadId) => {
    qc.invalidateQueries({ queryKey: runKeys.threads(wid, source.id) });
    if (tid) qc.invalidateQueries({ queryKey: runKeys.thread(wid, tid) });
  };

  /** @param {string} text @param {string | null} [parentMessageId] */
  async function ask(text, parentMessageId) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await api(`/workspaces/${wid}/runs`, {
        method: 'POST',
        body: {
          graph: 'grounded_qa',
          // An existing thread searches its own scope (see ScopeBar); a new one starts from this version plus attached documents.
          ...(activeThreadId ? { threadId: activeThreadId } : { scope: { sourceVersionIds: [version.id, ...extraScope.map((s) => s.sourceVersionId)] } }),
          ...(parentMessageId !== undefined && parentMessageId !== null ? { parentMessageId } : {}),
          input: { question: q },
          ...(model !== 'auto' ? { modelPreference: model } : {}),
        },
      });
      setQuestion('');
      setExtraScope([]);
      if (res.threadId && res.threadId !== activeThreadId) setThreadId(res.threadId);
      if (res.status === 'BUDGET_REJECTED') {
        setNotice({ kind: 'budget', question: q, estimate: res.estimate, remaining: res.remaining, budget: res.budget });
        if (res.userMessageId) setLeafId(res.userMessageId);
      } else {
        setLeafId(res.messageId);
      }
      refresh(res.threadId);
    } catch (e) {
      setNotice({ kind: 'error', message: e.code === 'EMPTY_SCOPE' ? 'This version is not indexed yet, so it cannot be searched.' : e.message });
    } finally {
      setSending(false);
    }
  }

  const [handled, setHandled] = useState(0);
  useEffect(() => {
    if (!request || request.at === handled) return;
    setHandled(request.at);
    if (request.kind === 'ask' && canAsk) ask(request.text, leaf ?? null);
    else {
      setQuestion(request.text);
      composerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per Lens request
  }, [request]);

  function openEvidence(message, marker, live) {
    const c = live?.[marker] ?? message.citations?.find((x) => x.marker === marker);
    const anchor = c?.anchor ?? null;
    const page = anchor?.selectors?.page;
    setEvidence({
      marker,
      state: c?.state ?? 'UNRESOLVED',
      anchorState: anchor?.state,
      title: source.title,
      versionNumber: versionLabel(anchor?.sourceVersionId ?? c?.sourceVersionId),
      currentVersionNumber: versionLabel(source.currentVersionId),
      locator: page ? `Page ${page}` : undefined,
      quote: c?.quote || null,
      anchor,
    });
  }

  return (
    <div className="chat-inner" aria-label="Grounded conversation" role="region">
      <div className="chat-h">
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <h2 style={{ fontSize: 15 }}>Ask {projectName ?? 'this document'}</h2>
          <ModelSelector options={options} value={model} onChange={setModel} disabled={!canAsk} />
        </div>
        <div className="row">
          {list.length > 0 && (
            <label className="row subtle grow" style={{ gap: 6, fontSize: 12 }}>
              Thread
              <select
                className="select"
                style={{ width: 'auto', maxWidth: 260, height: 28, fontSize: 12 }}
                value={threadId ?? ''}
                onChange={(e) => {
                  setThreadId(e.target.value);
                  setLeafId(null);
                }}
              >
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
                <option value="new">New conversation</option>
              </select>
            </label>
          )}
          <ThreadMenu
            wid={wid}
            sourceId={source.id}
            thread={activeThreadId ? thread.data ?? null : null}
            canEdit={canEdit}
            onSelect={(id) => {
              setThreadId(id);
              setLeafId(null);
            }}
            onArchived={() => {
              setThreadId(null);
              setLeafId(null);
            }}
          />
        </div>
        <ScopeBar
          wid={wid}
          projectId={projectId}
          source={source}
          version={version}
          thread={activeThreadId ? thread.data ?? null : null}
          extra={extraScope}
          setExtra={setExtraScope}
          canEdit={canEdit}
        />
        {branchList.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setComparing(true)} style={{ alignSelf: 'flex-start' }}>
            Compare branches
          </Button>
        )}
        {branchList.length > 1 && (
          <div className="btree" role="group" aria-label="Conversation branches">
            {branchList.map((b, i) => {
              const leafMsg = messages.find((m) => m.id === b.leafId);
              const outcome = leafMsg ? messageOutcome(leafMsg) : null;
              return (
                <button key={b.leafId} type="button" className={b.depth ? 'lvl' : undefined} aria-pressed={b.leafId === leaf} onClick={() => setLeafId(b.leafId)}>
                  <span className="mono">{String.fromCharCode(65 + i)}</span>
                  <span className="grow">{b.label}</span>
                  {outcome && <StatusBadge family="outcome" value={outcome} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="chat-scroll" ref={scrollRef} aria-live="polite">
        {threads.isPending || (activeThreadId && thread.isPending) ? (
          <Skeleton height={60} />
        ) : path.length === 0 ? (
          <p className="empty">Ask a question about this document. Answers cite the passages they rely on, and you can open each citation at its location.</p>
        ) : (
          path.map((m) =>
            m.role === 'USER' ? (
              <UserMessage key={m.id} message={m} canAsk={canAsk && !sending} isLeaf={m.id === leaf} onAskAgain={() => ask(m.content, m.parentMessageId ?? null)} />
            ) : (
              <AssistantMessage
                key={m.id}
                wid={wid}
                message={m}
                currentVersionNo={versionLabel(source.currentVersionId)}
                versionLabel={versionLabel}
                onFinished={() => refresh()}
                onCite={(marker, live) => openEvidence(m, marker, live)}
                onRetry={canAsk ? () => {
                  const parent = messages.find((x) => x.id === m.parentMessageId);
                  if (parent) ask(parent.content, parent.parentMessageId ?? null);
                } : undefined}
              />
            ),
          )
        )}
        {notice?.kind === 'budget' && (
          <Callout tone="bad" role="alert">
            <b>Budget limit reached.</b> This question would exceed {budgetScopeText(notice.budget)}, so it was not sent to a model and nothing was charged. Estimated cost{' '}
            {formatUsd(notice.estimate)}, remaining {formatUsd(notice.remaining)}. <Link to="/app/costs">Open Cost Center</Link>
          </Callout>
        )}
        {notice?.kind === 'error' && (
          <Callout tone="bad" role="alert">
            {notice.message}
          </Callout>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question, leaf ?? null);
        }}
      >
        <label className="sr" htmlFor={askId}>
          Ask a grounded question
        </label>
        <textarea
          ref={composerRef}
          id={askId}
          placeholder={canAsk ? 'Ask about this document…' : blockedReason ?? 'Asking is unavailable'}
          value={question}
          disabled={!canAsk}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question, leaf ?? null);
            }
          }}
        />
        <div className="row between">
          <span className="subtle row" style={{ fontSize: 12, gap: 6 }}>
            {!canAsk ? (
              blockedReason
            ) : estimate ? (
              <>
                <StatusBadge family="cost" value="PREFLIGHT_ESTIMATE" /> ≤ {formatUsd(estimate.amount.toFixed(8))}
                {estimate.isDemo && <DemoBadge />}
              </>
            ) : (
              'No price entered for this model; cost will be marked estimated.'
            )}
          </span>
          <Button variant="primary" type="submit" disabled={!canAsk || sending || !question.trim()}>
            {sending ? 'Asking…' : 'Ask'}
          </Button>
        </div>
      </form>

      <EvidenceDrawer
        open={Boolean(evidence)}
        onOpenChange={(o) => !o && setEvidence(null)}
        citation={evidence}
        onOpenSource={
          evidence?.anchor
            ? () => {
                onOpenCitation(evidence);
                setEvidence(null);
              }
            : undefined
        }
      />
      {comparing && <BranchCompareDialog open={comparing} onOpenChange={setComparing} messages={messages} branches={branchList} />}
    </div>
  );
}

function UserMessage({ message, canAsk, isLeaf, onAskAgain }) {
  return (
    <div className="stack" style={{ gap: 4, marginBottom: 14 }}>
      <p className="msg-user" style={{ marginBottom: 0 }}>
        {message.content}
      </p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        {isLeaf && <span className="subtle" style={{ fontSize: 12 }}>Not answered.</span>}
        {canAsk && (
          <Button size="sm" variant="ghost" onClick={onAskAgain} title="Runs the question again as a new branch">
            Ask again as a branch
          </Button>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ wid, message, currentVersionNo, versionLabel, onFinished, onCite, onRetry }) {
  const streaming = message.status === 'STREAMING';
  const live = useRunEvents(wid, message.aiRunId, { enabled: streaming && Boolean(message.aiRunId), onFinished });
  const text = streaming ? visibleText(live) : message.content;
  const liveCitations = streaming ? live.citations : null;
  const citations = liveCitations ?? Object.fromEntries((message.citations ?? []).map((c) => [c.marker, c]));
  const outcome = streaming ? live.outcome : messageOutcome(message);
  const status = streaming ? live.status : null;
  const versions = [...new Set(Object.values(citations).map((c) => c.anchor?.sourceVersionId ?? c.sourceVersionId).filter(Boolean))];
  const older = versions.map(versionLabel).filter((n) => n && currentVersionNo && n !== currentVersionNo);
  const abstained = outcome === 'ABSTAINED' || message.status === 'ABSTAINED';
  const failed = message.status === 'FAILED' || (streaming && live.done && ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(live.status));

  return (
    <div className="msg-ai ai-block" aria-busy={streaming && !live.done}>
      <span className="ai-tag">◆ {abstained ? 'AI · evidence check' : 'AI answer · grounded'}</span>
      {streaming && !live.done && (
        <div className="row">
          <StatusBadge family="run" value={status ?? 'QUEUED'} />
        </div>
      )}
      {text ? <CitedText text={text} citations={citations} onCite={(marker) => onCite(marker, liveCitations)} /> : !failed && <Skeleton width="70%" />}
      {failed && (
        <Callout tone="bad">
          {live.status === 'INTERRUPTED' || message.status === 'FAILED'
            ? 'The answer was interrupted before it finished. Any reserved budget was released.'
            : 'The answer could not be completed.'}{' '}
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </Callout>
      )}
      {abstained && <p className="subtle" style={{ fontSize: 12 }}>No model was called for this answer, so it cost nothing.</p>}
      {outcome && (
        <div className="row">
          <StatusBadge family="outcome" value={outcome} />
        </div>
      )}
      {older.length > 0 && <p className="vernote">⚠ Answered using version {older[0]} · Newer version available (v{currentVersionNo})</p>}
      {message.aiRunId && (!streaming || live.done) && <MessageReceipt wid={wid} runId={message.aiRunId} />}
    </div>
  );
}

function MessageReceipt({ wid, runId }) {
  const receipt = useReceipt(wid, runId);
  if (!receipt.data) return null;
  return <RunReceipt receipt={receipt.data} />;
}
