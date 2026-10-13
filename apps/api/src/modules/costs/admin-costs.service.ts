import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { env } from '../../config/env';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { BudgetService } from '../ledger/budget.service';
import { DAY_MS, isoDay, utcDay } from './cost-math';
import { fetchGcpBilling, IntegrationError } from './providers';

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const sumBy = <T>(xs: T[], key: (x: T) => string, amount: (x: T) => Decimal.Value) => {
  const m = new Map<string, Decimal>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? new Decimal(0)).plus(amount(x)));
  return m;
};
const top = (m: Map<string, Decimal>, n: number) => [...m.entries()].sort((a, b) => b[1].cmp(a[1])).slice(0, n);

/**
 * Platform-wide cost views for super admins. Metadata only: amounts, models, features and names, never run inputs
 * or document content.
 */
@Injectable()
export class AdminCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetService,
  ) {}

  async overview(days: number, model?: string) {
    const now = new Date();
    const today = utcDay(now);
    const since = new Date(today.getTime() - (days - 1) * DAY_MS);
    const [rollups, infra, running, reports, periods, rejected, runsByGraph, anomalies, calls] = await Promise.all([
      this.prisma.costRollup.findMany({ where: { granularity: 'DAY', bucketStart: { gte: since } } }),
      this.prisma.infraCost.findMany({ where: { day: { gte: since } } }),
      this.prisma.budgetReservation.aggregate({ where: { status: 'OPEN' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.providerCostReport.findMany({ where: { day: { gte: since } } }),
      this.prisma.budgetPeriod.findMany({ where: { periodEnd: { gt: now }, NOT: { alertsSent: { isEmpty: true } } }, include: { policy: true } }),
      this.prisma.aiRun.groupBy({ by: ['workspaceId'], where: { status: 'BUDGET_REJECTED', createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.aiRun.groupBy({ by: ['graph'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.costAnomaly.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.modelCall.findMany({ where: model ? { modelConfigId: model } : {}, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const dim = (d: string) => rollups.filter((r) => r.dimension === d);
    const aiRows = model ? dim('model').filter((r) => r.key === model) : dim('class').filter((r) => r.key === 'AI_API');
    const localRows = dim('class').filter((r) => r.key === 'LOCAL_COMPUTE');
    const usdInfra = infra.filter((i) => i.currency === 'USD');

    const dayKeys = Array.from({ length: days }, (_, i) => isoDay(new Date(since.getTime() + i * DAY_MS)));
    const ai = sumBy(aiRows, (r) => isoDay(r.bucketStart), (r) => r.amount.toString());
    const local = sumBy(localRows, (r) => isoDay(r.bucketStart), (r) => r.amount.toString());
    const cloud = sumBy(usdInfra, (r) => isoDay(r.day), (r) => r.amount.toString());
    const daily = dayKeys.map((d) => ({ date: d, aiApi: dec(ai.get(d)).toFixed(8), localCompute: dec(local.get(d)).toFixed(8), cloudInfra: dec(cloud.get(d)).toFixed(8) }));
    const total = (m: Map<string, Decimal>) => [...m.values()].reduce((a, b) => a.plus(b), new Decimal(0));

    const byModel = top(
      sumBy(
        dim('model').filter((r) => r.key !== 'local-compute' && (!model || r.key === model)),
        (r) => r.key,
        (r) => r.amount.toString(),
      ),
      10,
    ).map(([key, amount]) => ({ key, amount: amount.toFixed(8) }));
    const userRows = (model ? [] : dim('user')).filter((r) => r.key !== 'none');
    const topUsers = top(sumBy(userRows, (r) => `${r.workspaceId}|${r.key}`, (r) => r.amount.toString()), 8);
    const topWorkspaces = top(sumBy(dim('total'), (r) => r.workspaceId, (r) => r.amount.toString()), 8);
    const featureTotals = sumBy(dim('feature'), (r) => r.key, (r) => r.amount.toString());
    const runCounts = new Map(runsByGraph.map((g) => [g.graph, g._count._all]));

    const wsIds = [...new Set([...topUsers.map(([k]) => k.split('|')[0]), ...topWorkspaces.map(([k]) => k), ...periods.map((p) => p.workspaceId), ...rejected.map((r) => r.workspaceId), ...anomalies.map((a) => a.workspaceId)])];
    const userIds = [...new Set(topUsers.map(([k]) => k.split('|')[1]))];
    const [workspaces, users, usage, finals, runs] = await Promise.all([
      this.prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
      this.prisma.usageEvent.findMany({ where: { modelCallId: { in: calls.map((c) => c.id) } } }),
      this.prisma.costEntry.findMany({ where: { modelCallId: { in: calls.map((c) => c.id) }, entryType: 'FINAL' } }),
      this.prisma.aiRun.findMany({ where: { id: { in: calls.map((c) => c.runId) } }, select: { id: true, graph: true } }),
    ]);
    const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
    const userName = new Map(users.map((u) => [u.id, u.displayName]));

    const variance = reports.filter((r) => r.status === 'VARIANCE').reduce((a, r) => a.plus(dec(r.variance?.toString())), new Decimal(0));
    const aiTotal = total(ai);
    const localTotal = total(local);
    const cloudTotal = total(cloud);
    const latest = rollups.reduce<Date | null>((a, r) => (!a || r.updatedAt > a ? r.updatedAt : a), null);

    return {
      days,
      model: model ?? null,
      currency: 'USD',
      isDemo: rollups.some((r) => r.isDemo) || infra.some((i) => i.isDemo),
      rolledUpAt: latest,
      totals: {
        platform: aiTotal.plus(localTotal).plus(cloudTotal).toFixed(8),
        aiApi: aiTotal.toFixed(8),
        localCompute: localTotal.toFixed(8),
        cloudInfra: cloudTotal.toFixed(8),
        running: { amount: dec(running._sum.amount?.toString()).toFixed(8), runs: running._count._all },
        reconciliation: { variance: variance.toFixed(8), varianceDays: reports.filter((r) => r.status === 'VARIANCE').length, reconciledDays: reports.filter((r) => r.status === 'RECONCILED').length },
      },
      daily,
      byModel,
      topUsers: topUsers.map(([k, amount]) => {
        const [workspaceId, userId] = k.split('|');
        return { userId, name: userName.get(userId) ?? 'Unknown user', workspaceId, workspace: wsName.get(workspaceId) ?? '—', amount: amount.toFixed(8) };
      }),
      topWorkspaces: topWorkspaces.map(([id, amount]) => ({ workspaceId: id, workspace: wsName.get(id) ?? '—', amount: amount.toFixed(8) })),
      workflows: top(featureTotals, 10).map(([feature, amount]) => {
        const n = runCounts.get(feature) ?? 0;
        return { feature, runs: n, perRun: n ? amount.div(n).toFixed(8) : null, amount: amount.toFixed(8) };
      }),
      budgetAlerts: await Promise.all(
        periods.map(async (p) => ({
          workspaceId: p.workspaceId,
          workspace: wsName.get(p.workspaceId) ?? '—',
          label: await this.budgets.scopeLabel(p.policy),
          threshold: Math.max(...p.alertsSent),
          spent: p.spentFinal.toString(),
          limit: p.limitAmount.toString(),
        })),
      ),
      rejected: rejected.map((r) => ({ workspaceId: r.workspaceId, workspace: wsName.get(r.workspaceId) ?? '—', runs: r._count._all })),
      anomalies: anomalies.map((a) => ({
        id: a.id,
        workspaceId: a.workspaceId,
        workspace: wsName.get(a.workspaceId) ?? '—',
        day: isoDay(a.day),
        dimension: a.dimension,
        key: a.key,
        amount: a.amount.toString(),
        baselineMean: a.baselineMean.toString(),
        zScore: a.zScore,
        isDemo: a.isDemo,
      })),
      recentCalls: calls.map((c) => {
        const u = usage.find((x) => x.modelCallId === c.id);
        const f = finals.find((x) => x.modelCallId === c.id);
        return {
          id: c.id,
          runId: c.runId,
          graph: runs.find((r) => r.id === c.runId)?.graph ?? null,
          modelConfigId: c.modelConfigId,
          status: c.status,
          errorClass: c.errorClass,
          latencyMs: c.latencyMs,
          tokens: u ? { input: u.inputTokens, cachedInput: u.cachedInputTokens, output: u.outputTokens } : null,
          tier: f?.tier ?? null,
          amount: f?.amount.toString() ?? null,
          isDemo: f?.isDemo ?? u?.isDemo ?? false,
          createdAt: c.createdAt,
        };
      }),
    };
  }

  async infra(days: number) {
    const since = new Date(utcDay(new Date()).getTime() - (days - 1) * DAY_MS);
    const rows = await this.prisma.infraCost.findMany({ where: { day: { gte: since } }, orderBy: [{ day: 'desc' }, { service: 'asc' }] });
    const byService = top(
      sumBy(
        rows.filter((r) => r.currency === 'USD'),
        (r) => r.service,
        (r) => r.amount.toString(),
      ),
      20,
    ).map(([service, amount]) => ({ service, amount: amount.toFixed(8) }));
    return {
      gcpConfigured: !!env().FV_GCP_BILLING_TABLE,
      byService,
      rows: rows.map((r) => ({ ...r, day: isoDay(r.day), amount: r.amount.toString() })),
    };
  }

  async addInfra(input: { day: string; service: string; amount: string; currency?: string; note?: string; isDemo?: boolean }, userId: string) {
    const day = utcDay(`${input.day}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day > utcDay(new Date())) throw new BadRequestException({ message: 'The day must be today or earlier', code: 'INVALID_DAY' });
    if ((input.currency ?? 'USD') !== 'USD') throw new BadRequestException({ message: 'Only USD amounts are supported', code: 'CURRENCY_UNSUPPORTED' });
    return this.prisma.infraCost.create({
      data: { id: newId(), day, service: input.service.trim(), amount: input.amount, currency: 'USD', source: 'MANUAL', note: input.note?.trim() || null, isDemo: !!input.isDemo, enteredById: userId },
    });
  }

  /** Imports daily spend per service from the Cloud Billing export; re-imports replace amounts (exports are revised). */
  async importGcp(days: number) {
    const table = env().FV_GCP_BILLING_TABLE;
    if (!table) throw new ServiceUnavailableException({ message: 'Set FV_GCP_BILLING_TABLE to import cloud costs', code: 'GCP_BILLING_UNCONFIGURED' });
    let rows;
    try {
      rows = await fetchGcpBilling(table, new Date(utcDay(new Date()).getTime() - days * DAY_MS), { project: env().FV_GCP_PROJECT });
    } catch (e) {
      if (e instanceof IntegrationError) throw new ServiceUnavailableException({ message: e.message, code: e.code });
      throw e;
    }
    let imported = 0;
    for (const r of rows.filter((x) => x.currency === 'USD')) {
      const externalKey = `gcp:${r.day}:${r.service}`;
      await this.prisma.infraCost.upsert({
        where: { externalKey },
        create: { id: newId(), day: utcDay(`${r.day}T00:00:00Z`), service: r.service, amount: r.amount, currency: 'USD', source: 'GCP_BILLING_EXPORT', externalKey },
        update: { amount: r.amount },
      });
      imported++;
    }
    return { imported, skippedNonUsd: rows.length - imported };
  }
}
