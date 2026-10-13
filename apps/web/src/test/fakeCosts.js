/**
 * Cost intelligence half of the fake API: budgets, estimator, anomalies, notifications, members and the
 * super-admin cost and model registry routes. Every figure here is DEMO data.
 */
const DAY = 86400_000;
const usd = (n) => Number(n).toFixed(8);
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
const DEC = /^\d{1,10}(\.\d{1,8})?$/;

/**
 * @param {{ db: any, uuid: () => string, iso: (minutesAgo?: number) => string, ok: Function, problem: Function, noContent: Function,
 *   ai: any, opts: { superAdmin?: boolean, budgetLimit?: string } }} deps
 */
export function createFakeCosts({ db, uuid, iso, ok, problem, noContent, ai, opts }) {
  if (opts.superAdmin) db.user.platformRole = 'SUPER_ADMIN';
  const c = {
    /** Non-workspace budgets; the workspace budget is the AI fake's monthly budget. */
    budgets: [],
    workspaceBudget: new Map(),
    anomalies: [],
    notifications: [],
    adminModels: [],
    reports: [],
    infra: [],
    rolledUpAt: null,
  };
  db.costs = c;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const dayEnd = new Date(new Date(dayStart).getTime() + DAY).toISOString();

  for (const m of ai.models) {
    c.adminModels.push({
      id: m.id,
      provider: m.provider,
      model: m.model,
      displayName: m.displayName,
      status: m.isDefault ? 'VERIFIED' : 'UNVERIFIED',
      capabilities: ['chat'],
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      isDemo: true,
      isDefault: m.isDefault,
      available: true,
      prices: [{ id: uuid(), unit: 'MTOK', ...m.price, currency: 'USD', scheduled: false }],
    });
  }
  c.adminModels.push({
    id: 'local-compute',
    provider: 'local',
    model: 'cpu',
    displayName: 'Local compute (embeddings, rerank)',
    status: 'VERIFIED',
    capabilities: ['embed', 'rerank'],
    contextWindow: null,
    maxOutputTokens: null,
    isDemo: true,
    isDefault: false,
    available: true,
    prices: [],
  });
  const current = (m) => m.prices.find((p) => !p.scheduled)?.id ?? null;
  const adminModel = (m) => ({ ...m, currentPriceId: current(m) });

  const projectsOf = (wid) => db.projects.filter((p) => p.workspaceId === wid && !p.deletedAt);
  const roleIn = (wid) => db.memberships.find((m) => m.workspaceId === wid)?.role;
  const isAdmin = (wid) => ['ADMIN', 'OWNER'].includes(roleIn(wid));

  function workspacePolicy(wid) {
    if (!c.workspaceBudget.has(wid)) c.workspaceBudget.set(wid, { id: uuid(), alertThresholds: [75, 90, 100], period: 'MONTHLY' });
    return c.workspaceBudget.get(wid);
  }

  function budgetList(wid, status) {
    const meta = workspacePolicy(wid);
    const ws = {
      id: meta.id,
      scope: 'WORKSPACE',
      scopeRefId: null,
      label: 'Workspace budget',
      period: meta.period,
      hard: status.hard,
      currency: 'USD',
      alertThresholds: meta.alertThresholds,
      limit: status.limit,
      current: { periodStart: status.periodStart, periodEnd: status.periodEnd, limit: status.limit, spent: status.spent, reserved: status.reserved, remaining: status.remaining, alertsSent: [] },
    };
    const others = c.budgets
      .filter((b) => b.workspaceId === wid && (isAdmin(wid) || b.scope !== 'USER' || b.scopeRefId === db.user.id))
      .map((b) => {
        const [start, end] = b.period === 'DAILY' ? [dayStart, dayEnd] : [monthStart, monthEnd];
        return {
          id: b.id,
          scope: b.scope,
          scopeRefId: b.scopeRefId,
          label: b.scope === 'PROJECT' ? `Project ${db.projects.find((p) => p.id === b.scopeRefId)?.name ?? 'deleted'}` : `${db.user.displayName}’s AI budget`,
          period: b.period,
          hard: b.hard,
          currency: 'USD',
          alertThresholds: b.alertThresholds,
          limit: b.limitAmount,
          current: { periodStart: start, periodEnd: end, limit: b.limitAmount, spent: b.spent, reserved: '0', remaining: usd(Number(b.limitAmount) - Number(b.spent)), alertsSent: [] },
        };
      });
    return [ws, ...others];
  }

  function localCompute(wid) {
    const seconds = ai.ai.costEntries.some((e) => e.workspaceId === wid) ? 42.5 : 0;
    return { amount: usd(0), seconds, priced: false };
  }

  function summary(wid, days, model) {
    const base = ai.summary(wid, days, model);
    const finals = ai.ai.costEntries.filter((e) => e.workspaceId === wid && e.entryType === 'FINAL' && e.costClass === 'AI_API' && (!model || e.modelConfigId === model));
    const total = finals.reduce((a, e) => a + Number(e.amount), 0);
    const project = projectsOf(wid).find((p) => p.kind === 'KNOWLEDGE');
    const byProject = total > 0 ? [{ key: project?.name ?? 'No project', amount: usd(total) }] : [];
    return {
      ...base,
      byProject,
      byUser: isAdmin(wid) ? (total > 0 ? [{ key: db.user.displayName, amount: usd(total) }] : []) : null,
      localCompute: localCompute(wid),
      budgets: budgetList(wid, base.budget),
      anomalies: c.anomalies.filter((a) => a.workspaceId === wid).map(({ workspaceId: _w, ...a }) => a),
    };
  }

  function estimate(body) {
    const m = ai.models.find((x) => x.id === body.modelConfigId);
    const calls = Math.max(1, body.calls ?? 1);
    if (!m?.price) return { modelConfigId: body.modelConfigId, calls, perCall: usd(0), total: usd(0), currency: 'USD', status: 'PRICE_MISSING', price: null };
    const cached = Math.min(body.cachedInputTokens ?? 0, body.inputTokens);
    const p = m.price;
    const per = ((body.inputTokens - cached) * Number(p.inputPerMTok) + cached * Number(p.cachedInputPerMTok ?? p.inputPerMTok) + body.outputTokens * Number(p.outputPerMTok)) / 1e6;
    return { modelConfigId: m.id, calls, perCall: usd(per), total: usd(per * calls), currency: 'USD', status: 'PRICED', price: p };
  }

  function csv(wid) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = ai.ai.costEntries.filter((e) => e.workspaceId === wid);
    const header = 'created_at,entry_id,run_id,entry_type,tier,cost_class,model,feature,amount,currency,reason,supersedes_entry_id,is_demo';
    return [header, ...rows.map((e) => [e.createdAt, e.id, e.runId, e.entryType, e.tier, e.costClass, e.modelConfigId, e.feature, e.amount, e.currency, e.reason, null, e.isDemo].map(cell).join(','))].join('\n') + '\n';
  }

  /** Workspace-scoped routes; undefined when the path is not a cost route. */
  function handle(method, wid, rest, body, need, query) {
    const r = rest.join('/');
    if (r === 'costs/summary' && method === 'GET') return ok(summary(wid, Math.min(Math.max(Number(query.get('days')) || 30, 1), 365), query.get('model') || null));
    if (r === 'costs/estimate' && method === 'POST') {
      if (!body?.modelConfigId || !Number.isInteger(body.inputTokens) || !Number.isInteger(body.outputTokens)) return problem(400, 'inputTokens must be an integer', 'VALIDATION');
      return ok(estimate(body));
    }
    if (r === 'costs/anomalies' && method === 'GET') return ok(c.anomalies.filter((a) => a.workspaceId === wid));
    if (r === 'costs/export.csv' && method === 'GET') return { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' }, body: csv(wid) };
    if (r === 'members' && method === 'GET') return ok([{ userId: db.user.id, email: db.user.email, displayName: db.user.displayName, role: roleIn(wid) }]);
    if (r === 'notifications' && method === 'GET') return ok(c.notifications.filter((n) => n.workspaceId === wid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    if (r === 'notifications/read-all' && method === 'POST') {
      for (const n of c.notifications) if (n.workspaceId === wid && !n.readAt) n.readAt = iso();
      return noContent();
    }
    if (rest[0] !== 'budgets') return undefined;
    if (rest.length === 1 && method === 'GET') return ok(budgetList(wid, ai.budgetStatus(wid)));
    const denied = need('ADMIN');
    if (denied) return denied;
    if (rest.length === 1 && method === 'POST') {
      if (!DEC.test(body?.limitAmount ?? '')) return problem(400, 'limitAmount must match /^\\d{1,10}(\\.\\d{1,8})?$/', 'VALIDATION');
      if (body.scope !== 'WORKSPACE' && !body.scopeRefId) return problem(400, 'Pick the project or member this budget applies to', 'SCOPE_REF_REQUIRED');
      if (body.scope === 'WORKSPACE' || c.budgets.some((b) => b.workspaceId === wid && b.scope === body.scope && b.scopeRefId === body.scopeRefId)) {
        return problem(409, 'A budget for this scope already exists; edit it instead', 'BUDGET_EXISTS');
      }
      const b = {
        id: uuid(),
        workspaceId: wid,
        scope: body.scope,
        scopeRefId: body.scopeRefId,
        period: body.period ?? 'MONTHLY',
        limitAmount: body.limitAmount,
        hard: body.hard ?? true,
        alertThresholds: [...new Set(body.alertThresholds ?? [75, 90, 100])].sort((a, b2) => a - b2),
        spent: '0.00000000',
      };
      c.budgets.push(b);
      return ok(budgetList(wid, ai.budgetStatus(wid)).find((x) => x.id === b.id), 201);
    }
    const id = rest[1];
    const meta = workspacePolicy(wid);
    if (id === meta.id) {
      if (method === 'DELETE') return problem(400, 'The workspace budget cannot be deleted', 'VALIDATION');
      if (method === 'PATCH') {
        if (body.limitAmount) ai.ai.budget.limit = body.limitAmount;
        if (body.hard !== undefined) ai.ai.budget.hard = body.hard;
        if (body.alertThresholds) meta.alertThresholds = [...new Set(body.alertThresholds)].sort((a, b2) => a - b2);
        if (body.period) meta.period = body.period;
        return ok(budgetList(wid, ai.budgetStatus(wid))[0]);
      }
    }
    const b = c.budgets.find((x) => x.id === id && x.workspaceId === wid);
    if (!b) return problem(404, 'Not found');
    if (method === 'DELETE') {
      c.budgets.splice(c.budgets.indexOf(b), 1);
      return noContent();
    }
    if (method === 'PATCH') {
      if (body.limitAmount) b.limitAmount = body.limitAmount;
      if (body.hard !== undefined) b.hard = body.hard;
      if (body.period) b.period = body.period;
      if (body.alertThresholds) b.alertThresholds = [...new Set(body.alertThresholds)].sort((a, b2) => a - b2);
      return ok(budgetList(wid, ai.budgetStatus(wid)).find((x) => x.id === b.id));
    }
    return undefined;
  }

  // ── super admin ──
  const recentDays = (n) => Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * DAY));

  function overview(days, model) {
    const finals = ai.ai.costEntries.filter((e) => e.entryType === 'FINAL' && e.costClass === 'AI_API' && (!model || e.modelConfigId === model));
    const total = finals.reduce((a, e) => a + Number(e.amount), 0);
    const cloud = c.infra.reduce((a, r) => a + Number(r.amount), 0);
    const byModel = new Map();
    for (const e of finals) byModel.set(e.modelConfigId, (byModel.get(e.modelConfigId) ?? 0) + Number(e.amount));
    const byFeature = new Map();
    for (const e of finals) byFeature.set(e.feature, (byFeature.get(e.feature) ?? 0) + Number(e.amount));
    const runs = ai.ai.runs.filter((r) => r.status !== 'BUDGET_REJECTED');
    const ws = db.workspaces[0];
    const variance = c.reports.filter((r) => r.status === 'VARIANCE').reduce((a, r) => a + Number(r.variance), 0);
    return {
      days,
      model,
      currency: 'USD',
      isDemo: true,
      rolledUpAt: c.rolledUpAt,
      totals: {
        platform: usd(total + cloud),
        aiApi: usd(total),
        localCompute: usd(0),
        cloudInfra: usd(cloud),
        running: { amount: usd(0), runs: 0 },
        reconciliation: { variance: usd(variance), varianceDays: c.reports.filter((r) => r.status === 'VARIANCE').length, reconciledDays: c.reports.filter((r) => r.status === 'RECONCILED').length },
      },
      daily: recentDays(days).map((date) => ({
        date,
        aiApi: usd(finals.filter((e) => e.createdAt.slice(0, 10) === date).reduce((a, e) => a + Number(e.amount), 0)),
        cloudInfra: usd(c.infra.filter((r) => r.day === date).reduce((a, r) => a + Number(r.amount), 0)),
        localCompute: usd(0),
      })),
      byModel: [...byModel].map(([key, v]) => ({ key, amount: usd(v) })),
      topUsers: model || !total ? [] : [{ userId: db.user.id, name: db.user.displayName, workspaceId: ws.id, workspace: ws.name, amount: usd(total) }],
      topWorkspaces: total ? [{ workspaceId: ws.id, workspace: ws.name, amount: usd(total) }] : [],
      workflows: [...byFeature].map(([feature, v]) => {
        const n = runs.filter((r) => r.graph === feature).length;
        return { feature, runs: n, perRun: n ? usd(v / n) : null, amount: usd(v) };
      }),
      budgetAlerts: [],
      rejected: ai.ai.runs.some((r) => r.status === 'BUDGET_REJECTED') ? [{ workspaceId: ws.id, workspace: ws.name, runs: ai.ai.runs.filter((r) => r.status === 'BUDGET_REJECTED').length }] : [],
      anomalies: c.anomalies.map((a) => ({ ...a, workspace: db.workspaces.find((w) => w.id === a.workspaceId)?.name ?? '—' })),
      recentCalls: finals.slice(0, 20).map((e) => ({
        id: e.id,
        runId: e.runId,
        graph: e.feature,
        modelConfigId: e.modelConfigId,
        status: 'SUCCEEDED',
        errorClass: null,
        latencyMs: 840,
        tokens: { input: 1200, cachedInput: 0, output: 80 },
        tier: e.tier,
        amount: e.amount,
        isDemo: true,
        createdAt: e.createdAt,
      })),
    };
  }

  function ledgerOn(day) {
    return ai.ai.costEntries.filter((e) => e.entryType === 'FINAL' && e.costClass === 'AI_API' && e.createdAt.slice(0, 10) === day).reduce((a, e) => a + Number(e.amount), 0);
  }

  function reconciliation(days) {
    const since = recentDays(days)[0];
    const today = isoDay(Date.now());
    const rows = new Map();
    for (const e of ai.ai.costEntries) {
      const day = e.createdAt.slice(0, 10);
      if (e.entryType !== 'FINAL' || e.costClass !== 'AI_API' || day < since) continue;
      rows.set(`mock|${day}`, { provider: 'mock', day, ledger: usd(ledgerOn(day)), entries: 1, isDemo: true, report: null, variance: null, source: null, status: day === today ? 'OPEN' : 'PENDING' });
    }
    for (const r of c.reports) rows.set(`${r.provider}|${r.day}`, { ...(rows.get(`${r.provider}|${r.day}`) ?? { entries: 0 }), ...r });
    return {
      tolerance: '0.01',
      apiConfigured: { openai: false },
      rows: [...rows.values()].sort((a, b) => b.day.localeCompare(a.day) || a.provider.localeCompare(b.provider)),
    };
  }

  function importCsv(provider, text) {
    const lines = String(text).trim().split(/\r?\n/);
    const head = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
    const di = head.findIndex((h) => ['date', 'day', 'start_time'].includes(h));
    const amountIdx = head.findIndex((h) => ['amount', 'cost', 'amount_value'].includes(h));
    if (di < 0 || amountIdx < 0) return problem(400, 'The CSV needs a date column and an amount column', 'CSV_INVALID');
    const today = isoDay(Date.now());
    const results = [];
    for (const line of lines) {
      const cols = line.split(',');
      const day = cols[di]?.trim().slice(0, 10);
      const amount = Number(cols[amountIdx]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !Number.isFinite(amount)) continue;
      if (day >= today) {
        results.push({ day, status: 'SKIPPED', reason: 'DAY_NOT_CLOSED' });
        continue;
      }
      const prior = c.reports.find((r) => r.provider === provider && r.day === day);
      if (prior) {
        results.push({ day, status: Number(prior.report) === amount ? 'UNCHANGED' : 'CONFLICT', reason: Number(prior.report) === amount ? undefined : 'ALREADY_RECONCILED' });
        continue;
      }
      const ledger = ledgerOn(day);
      const variance = amount - ledger;
      const status = Math.abs(variance) <= 0.01 ? 'RECONCILED' : 'VARIANCE';
      c.reports.push({ provider, day, ledger: usd(ledger), report: usd(amount), variance: usd(variance), status, source: 'CSV', isDemo: provider === 'mock' });
      results.push({ day, status, ledger: usd(ledger), report: usd(amount), variance: usd(variance), entries: 1 });
    }
    return ok({ results: results.sort((a, b) => a.day.localeCompare(b.day)), errors: [] });
  }

  function handleAdmin(method, seg, body, query) {
    if (db.user.platformRole !== 'SUPER_ADMIN') return problem(404, 'Not found');
    const r = seg.join('/');
    const days = Math.min(Math.max(Number(query.get('days')) || 30, 1), 365);
    if (r === 'models' && method === 'GET') return ok(c.adminModels.map(adminModel));
    if (r === 'models/registry/diff' && method === 'GET') {
      return ok({ added: [{ id: 'openai-chat', provider: 'openai', displayName: 'OpenAI chat model', blockedBy: 'FV_OPENAI_CHAT_MODEL' }], removed: [], changed: [] });
    }
    if (r === 'models/registry/sync' && method === 'POST') return ok({ created: [] });
    if (seg[0] === 'models' && seg[1]) {
      const m = c.adminModels.find((x) => x.id === decodeURIComponent(seg[1]));
      if (!m) return problem(404, 'Not found');
      if (seg.length === 2 && method === 'PATCH') {
        if (body.isDefault && !m.capabilities.includes('chat')) return problem(400, 'Only chat models can be the default', 'NOT_CHAT_MODEL');
        if (body.isDefault) for (const x of c.adminModels) x.isDefault = false;
        Object.assign(m, body.status ? { status: body.status } : {}, body.isDefault !== undefined ? { isDefault: body.isDefault } : {});
        return ok(m);
      }
      if (seg[2] === 'prices' && method === 'POST') {
        const unit = body.unit ?? (m.provider === 'local' ? 'CPU_HOUR' : 'MTOK');
        if ((unit === 'CPU_HOUR') !== (m.provider === 'local')) return problem(400, 'Local compute is priced per CPU-hour; models are priced per 1M tokens', 'PRICE_UNIT_MISMATCH');
        if (unit === 'MTOK' && body.outputPerMTok === undefined) return problem(400, 'An output price is required', 'OUTPUT_PRICE_REQUIRED');
        const source = String(body.sourceUrl ?? '').trim();
        if (!(body.isDemo ? /^(https:\/\/|demo:\/\/)\S+$/ : /^https:\/\/[^\s/]+\.\S+$/).test(source)) {
          return problem(400, 'Give the https page where the price is published (demo:// only for DEMO prices)', 'SOURCE_URL_REQUIRED');
        }
        const effectiveFrom = body.effectiveFrom ?? iso();
        const scheduled = new Date(effectiveFrom).getTime() > Date.now();
        const p = { id: uuid(), unit, inputPerMTok: body.inputPerMTok, outputPerMTok: unit === 'CPU_HOUR' ? '0' : body.outputPerMTok, cachedInputPerMTok: body.cachedInputPerMTok ?? null, currency: 'USD', effectiveFrom, sourceUrl: source, isDemo: !!body.isDemo, scheduled };
        m.prices.unshift(p);
        m.prices.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
        const backdated = ai.ai.costEntries.some((e) => e.modelConfigId === m.id && e.entryType === 'FINAL' && e.createdAt > effectiveFrom);
        return ok({ ...p, note: backdated ? 'Entries already finalized keep the price they were calculated with; this price applies to usage from now on.' : null }, 201);
      }
    }
    if (r === 'costs/overview' && method === 'GET') return ok(overview(days, query.get('model') || null));
    if (r === 'costs/rollup' && method === 'POST') {
      c.rolledUpAt = iso();
      return ok({ since: iso(body?.days ? body.days * 1440 : 2880), rows: 12, anomalies: 0 });
    }
    if (r === 'costs/reconciliation' && method === 'GET') return ok(reconciliation(Math.min(Math.max(Number(query.get('days')) || 14, 1), 365)));
    if (r === 'costs/reconciliation/import' && method === 'POST') return importCsv(body.provider, body.csv);
    if (r === 'costs/reconciliation/fetch' && method === 'POST') return problem(503, 'The OpenAI Costs API is not configured (OPENAI_ADMIN_KEY)', 'RECONCILIATION_UNCONFIGURED');
    if (r === 'costs/infra' && method === 'GET') {
      const byService = new Map();
      for (const x of c.infra) byService.set(x.service, (byService.get(x.service) ?? 0) + Number(x.amount));
      return ok({ gcpConfigured: false, byService: [...byService].map(([service, v]) => ({ service, amount: usd(v) })), rows: [...c.infra].sort((a, b) => b.day.localeCompare(a.day)) });
    }
    if (r === 'costs/infra' && method === 'POST') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.day ?? '') || body.day > isoDay(Date.now())) return problem(400, 'Pick a day that has already started', 'INVALID_DAY');
      if (!DEC.test(body.amount ?? '')) return problem(400, 'amount must be a decimal', 'VALIDATION');
      const row = { id: uuid(), day: body.day, service: body.service, amount: usd(body.amount), currency: 'USD', source: 'MANUAL', note: body.note ?? null, isDemo: !!body.isDemo };
      c.infra.push(row);
      return ok(row, 201);
    }
    if (r === 'costs/infra/import-gcp' && method === 'POST') return problem(503, 'The GCP billing export is not configured (FV_GCP_BILLING_TABLE)', 'GCP_BILLING_UNCONFIGURED');
    return problem(404, 'Not found');
  }

  /** Adds an anomaly and a notification, as the rollup worker would. */
  function seedAnomaly(wid) {
    const day = isoDay(Date.now() - DAY);
    c.anomalies.push({ id: uuid(), workspaceId: wid, day, dimension: 'total', key: 'all', amount: '4.20000000', baselineMean: '0.35000000', zScore: 6.4, isDemo: true });
    c.notifications.push({ id: uuid(), workspaceId: wid, userId: db.user.id, kind: 'cost.anomaly', title: 'Unusual AI spend', body: `AI spend on ${day} was $4.20, well above the 14-day average of $0.35 (DEMO).`, link: '/app/costs', readAt: null, createdAt: iso(30) });
  }

  return { costs: c, handle, handleAdmin, seedAnomaly };
}
