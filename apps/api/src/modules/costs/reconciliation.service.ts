import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { env } from '../../config/env';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { allocate, DAY_MS, isoDay, ProviderDay, utcDay } from './cost-math';
import { fetchOpenAiDailyCosts, IntegrationError } from './providers';

export interface ImportResult {
  day: string;
  status: 'RECONCILED' | 'VARIANCE' | 'SKIPPED' | 'CONFLICT';
  reason?: string;
  ledger?: string;
  report?: string;
  variance?: string;
  entries?: number;
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  private async finalsFor(provider: string, day: Date) {
    const configs = await this.prisma.modelConfig.findMany({ where: { provider }, select: { id: true } });
    return this.prisma.costEntry.findMany({
      where: {
        entryType: 'FINAL',
        costClass: 'AI_API',
        modelConfigId: { in: configs.map((c) => c.id) },
        createdAt: { gte: day, lt: new Date(day.getTime() + DAY_MS) },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Ledger FINAL AI spend per provider and UTC day. */
  async ledgerByDay(since: Date, until: Date) {
    const rows = await this.prisma.$queryRaw<{ provider: string; day: Date; amount: string; entries: number; is_demo: boolean }[]>`
      SELECT mc.provider, date_trunc('day', ce.created_at) AS day, SUM(ce.amount)::text AS amount, COUNT(*)::int AS entries, bool_or(ce.is_demo) AS is_demo
        FROM app.cost_entries ce
        JOIN app.model_configs mc ON mc.id = ce.model_config_id
       WHERE ce.entry_type = 'FINAL' AND ce.cost_class = 'AI_API' AND ce.created_at >= ${since} AND ce.created_at < ${until}
       GROUP BY 1, 2`;
    return rows;
  }

  /** Ledger vs provider report per provider and day (newest first); days without a report are PENDING. */
  async list(days: number) {
    const today = utcDay(new Date());
    const since = new Date(today.getTime() - (days - 1) * DAY_MS);
    const [ledger, reports] = await Promise.all([
      this.ledgerByDay(since, new Date(today.getTime() + DAY_MS)),
      this.prisma.providerCostReport.findMany({ where: { day: { gte: since } } }),
    ]);
    const key = (p: string, d: Date) => `${p}|${isoDay(d)}`;
    const rows = new Map<string, any>();
    for (const l of ledger) {
      rows.set(key(l.provider, l.day), { provider: l.provider, day: isoDay(l.day), ledger: new Decimal(l.amount).toFixed(8), entries: l.entries, isDemo: l.is_demo });
    }
    for (const r of reports) {
      const k = key(r.provider, r.day);
      const row = rows.get(k) ?? { provider: r.provider, day: isoDay(r.day), ledger: '0.00000000', entries: 0, isDemo: r.isDemo };
      rows.set(k, {
        ...row,
        ledger: r.ledgerAmount ? r.ledgerAmount.toString() : row.ledger,
        report: r.amount.toString(),
        variance: r.variance?.toString() ?? null,
        status: r.status,
        source: r.source,
        isDemo: row.isDemo || r.isDemo,
      });
    }
    const out = [...rows.values()].map((r) => ({
      report: null,
      variance: null,
      source: null,
      ...r,
      status: r.status ?? (r.day === isoDay(today) ? 'OPEN' : 'PENDING'),
    }));
    out.sort((a, b) => b.day.localeCompare(a.day) || a.provider.localeCompare(b.provider));
    return { tolerance: env().FV_RECON_TOLERANCE_USD, apiConfigured: { openai: !!env().OPENAI_ADMIN_KEY }, rows: out };
  }

  /** Stores provider amounts for closed days and reconciles each day once. */
  async importDays(provider: string, days: ProviderDay[], source: 'CSV' | 'API', userId: string | null): Promise<ImportResult[]> {
    const today = utcDay(new Date());
    const isDemo = provider === 'mock';
    const out: ImportResult[] = [];
    for (const d of days) {
      const day = utcDay(`${d.day}T00:00:00Z`);
      if (day.getTime() >= today.getTime()) {
        out.push({ day: d.day, status: 'SKIPPED', reason: 'DAY_NOT_CLOSED' });
        continue;
      }
      if (d.currency !== 'USD') {
        out.push({ day: d.day, status: 'SKIPPED', reason: 'CURRENCY_UNSUPPORTED' });
        continue;
      }
      const existing = await this.prisma.providerCostReport.findUnique({ where: { provider_day: { provider, day } } });
      if (existing && existing.status !== 'PENDING') {
        const same = new Decimal(existing.amount.toString()).eq(d.amount);
        out.push(
          same
            ? { day: d.day, status: existing.status as 'RECONCILED' | 'VARIANCE', reason: 'UNCHANGED', report: existing.amount.toString(), variance: existing.variance?.toString() }
            : { day: d.day, status: 'CONFLICT', reason: 'ALREADY_RECONCILED', report: existing.amount.toString() },
        );
        continue;
      }
      await this.prisma.providerCostReport.upsert({
        where: { provider_day: { provider, day } },
        create: { id: newId(), provider, day, amount: d.amount, currency: d.currency, source, isDemo, importedById: userId },
        update: { amount: d.amount, source, importedById: userId },
      });
      out.push(await this.reconcileDay(provider, day));
    }
    return out;
  }

  /**
   * Compares one closed day with the provider's figure. Within tolerance every FINAL entry gets a zero RECONCILED
   * entry; otherwise the difference is split pro rata as VARIANCE entries. Both supersede the FINAL entry they
   * belong to; nothing is edited.
   */
  async reconcileDay(provider: string, day: Date): Promise<ImportResult> {
    const report = await this.prisma.providerCostReport.findUniqueOrThrow({ where: { provider_day: { provider, day } } });
    const claimed = await this.prisma.providerCostReport.updateMany({ where: { id: report.id, status: 'PENDING' }, data: { status: 'RECONCILING' } });
    if (!claimed.count) return { day: isoDay(day), status: 'CONFLICT', reason: 'IN_PROGRESS' };
    try {
      const finals = await this.finalsFor(provider, day);
      const ledger = finals.reduce((a, e) => a.plus(e.amount.toString()), new Decimal(0));
      const variance = new Decimal(report.amount.toString()).minus(ledger);
      const within = variance.abs().lte(env().FV_RECON_TOLERANCE_USD);
      const shares = within ? finals.map(() => new Decimal(0)) : allocate(variance, finals.map((e) => e.amount.toString()));
      const reason = `${provider} report ${isoDay(day)}`;
      await this.prisma.costEntry.createMany({
        data: finals.map((e, i) => ({
          id: newId(),
          workspaceId: e.workspaceId,
          userId: e.userId,
          runId: e.runId,
          usageEventId: e.usageEventId,
          modelCallId: e.modelCallId,
          modelConfigId: e.modelConfigId,
          entryType: within ? 'RECONCILIATION' : 'VARIANCE',
          tier: within ? 'RECONCILED' : 'VARIANCE',
          costClass: e.costClass,
          amount: shares[i].toFixed(8),
          currency: e.currency,
          priceId: e.priceId,
          reason,
          supersedesEntryId: e.id,
          feature: e.feature,
          isDemo: e.isDemo || report.isDemo,
        })),
        skipDuplicates: true,
      });
      const status = within ? 'RECONCILED' : 'VARIANCE';
      await this.prisma.providerCostReport.update({
        where: { id: report.id },
        data: { status, ledgerAmount: ledger.toFixed(8), variance: variance.toFixed(8), entries: finals.length, reconciledAt: new Date() },
      });
      return { day: isoDay(day), status, ledger: ledger.toFixed(8), report: report.amount.toString(), variance: variance.toFixed(8), entries: finals.length };
    } catch (e) {
      await this.prisma.providerCostReport.update({ where: { id: report.id }, data: { status: 'PENDING' } });
      throw e;
    }
  }

  /** Pulls closed days from the OpenAI Costs API. Needs `OPENAI_ADMIN_KEY`. */
  async fetchOpenAi(days: number, userId: string) {
    const key = env().OPENAI_ADMIN_KEY;
    if (!key) throw new ServiceUnavailableException({ message: 'Set OPENAI_ADMIN_KEY to import provider costs', code: 'RECONCILIATION_UNCONFIGURED' });
    const today = utcDay(new Date());
    try {
      const rows = await fetchOpenAiDailyCosts(key, new Date(today.getTime() - days * DAY_MS), today);
      return this.importDays('openai', rows, 'API', userId);
    } catch (e) {
      if (e instanceof IntegrationError) throw new ServiceUnavailableException({ message: e.message, code: e.code });
      throw e;
    }
  }
}