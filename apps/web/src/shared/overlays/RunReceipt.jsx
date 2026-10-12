import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../icons.jsx';
import { DemoBadge, StatusBadge } from '../StatusBadge.jsx';
import { formatInt, formatMs, formatUsd } from '../format.js';

/**
 * Run receipt: what ran, which model, tokens, cost tier and evidence. Takes the API receipt
 * (`GET /api/workspaces/:id/runs/:runId/receipt`). Model reasoning is never shown.
 * @param {{ receipt: any, defaultOpen?: boolean, actionLabel?: string }} props
 */
export function RunReceipt({ receipt, defaultOpen = false, actionLabel }) {
  const [open, setOpen] = useState(defaultOpen);
  const { run, cost, tokens, modelPlan, modelCalls = [], citations } = receipt;
  const lastCall = modelCalls.at(-1);
  const model = lastCall ? `${lastCall.provider} · ${lastCall.model}` : modelPlan?.primary ? `${modelPlan.primary.provider} · ${modelPlan.primary.model}` : null;
  const fallbackUsed = modelCalls.length > 1;
  const byState = citations?.byState ?? {};
  const demo = cost?.isDemo || run?.isDemo;
  const bodyId = `rc-${run.id}`;

  return (
    <div className="receipt">
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <Icon name="chev" size={13} />
        <b>Run receipt</b>
        <span className="mono subtle">{run.id}</span>
        <span className="grow" />
        {cost?.tier && <StatusBadge family="cost" value={cost.tier} />}
        <span className="mono">
          {demo ? 'DEMO ' : ''}
          {formatUsd(cost?.total)}
        </span>
      </button>
      {open && (
        <div className="rc-body" id={bodyId}>
          <dl className="kv">
            {actionLabel && (
              <>
                <dt>Action</dt>
                <dd>{actionLabel}</dd>
              </>
            )}
            <dt>Workflow</dt>
            <dd className="mono">
              {run.graph} · {run.tier}
            </dd>
            <dt>Status</dt>
            <dd className="row" style={{ gap: 6 }}>
              <StatusBadge family="run" value={run.status} />
              {run.outcome && <StatusBadge family="outcome" value={run.outcome} />}
            </dd>
            <dt>Model</dt>
            <dd>
              {model ?? <span className="subtle">No model call</span>}
              {fallbackUsed && <span className="subtle"> (after {modelCalls.length - 1} fallback attempt{modelCalls.length > 2 ? 's' : ''})</span>}
            </dd>
            <dt>Tokens</dt>
            <dd className="mono">
              {formatInt(tokens?.input)} in
              {tokens?.cachedInput ? ` (${formatInt(tokens.cachedInput)} cached)` : ''} · {formatInt(tokens?.output)} out
              {tokens?.reasoning ? ` · ${formatInt(tokens.reasoning)} reasoning` : ''}
            </dd>
            <dt>Cost</dt>
            <dd>
              {cost?.estimate != null && <>Estimate {formatUsd(cost.estimate)} → </>}
              {cost?.tier && <StatusBadge family="cost" value={cost.tier} />} <span className="mono">{formatUsd(cost?.total)}</span>
            </dd>
            <dt>Latency</dt>
            <dd>{formatMs(run.durationMs)}</dd>
            <dt>Evidence</dt>
            <dd>
              {citations?.total ?? 0} citation{citations?.total === 1 ? '' : 's'}
              {Object.entries(byState).map(([k, n]) => (
                <span key={k}>
                  {' '}
                  · {n} {k.toLowerCase().replace('_', ' ')}
                </span>
              ))}
            </dd>
            <dt>Trace</dt>
            <dd>
              <Link to={receipt.traceUrl ?? `/app/studio/runs/${run.id}`}>Open in Developer Studio →</Link>
            </dd>
          </dl>
          <p className="subtle row" style={{ fontSize: 11, marginTop: 8 }}>
            {demo && <DemoBadge />}
            {demo ? 'Mock provider output; amounts use demo rates.' : 'Amounts come from the cost ledger.'} Model reasoning is never displayed.
          </p>
        </div>
      )}
    </div>
  );
}
