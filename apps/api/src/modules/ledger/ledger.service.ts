import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { newId } from '../../common/ids';
import { fvMetrics } from '../../infra/observability';
import { PrismaService } from '../../infra/prisma.service';
import { BudgetService } from './budget.service';
import { priceUsage } from './pricing';

@Injectable()
export class LedgerService {
  private readonly log = new Logger('Ledger');

  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetService,
  ) {}

  /** Price effective at `at` for a model config, or null when none was entered. */
  async priceFor(modelConfigId: string | null | undefined, at = new Date()) {
    if (!modelConfigId) return null;
    return this.prisma.modelPrice.findFirst({
      where: { modelConfigId, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Converts one usage event into a FINAL cost entry transactionally and idempotently.
   * Repairs missing budget spend if a crash occurred previously between cost entry creation and spend update.
   */
  async processUsageEvent(usageEventId: string): Promise<'created' | 'duplicate' | 'missing'> {
    const pendingAlerts: any[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      const ev = await tx.usageEvent.findUnique({ where: { id: usageEventId } });
      if (!ev) return { outcome: 'missing' as const, metrics: null };

      const existingCost = await tx.costEntry.findFirst({
        where: { usageEventId: ev.id, entryType: 'FINAL' },
      });

      if (existingCost) {
        if (ev.processedAt) return { outcome: 'duplicate' as const, metrics: null };
        // Crash recovery repair path: cost entry exists, but process crashed before budget spend increment and processedAt
        if (ev.costClass === 'AI_API') {
          const run = ev.runId ? await tx.aiRun.findUnique({ where: { id: ev.runId } }) : null;
          const alerts = await this.budgets.addSpend(
            ev.workspaceId,
            new Decimal(existingCost.amount.toString()),
            { runId: ev.runId, userId: ev.userId ?? run?.userId },
            tx,
          );
          pendingAlerts.push(...alerts);
        }
        await tx.usageEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
        return { outcome: 'created' as const, metrics: null };
      }

      if (ev.processedAt) return { outcome: 'duplicate' as const, metrics: null };

      const run = ev.runId ? await tx.aiRun.findUnique({ where: { id: ev.runId } }) : null;

      let amount: Decimal;
      let tier: 'FINALIZED' | 'FINAL_ESTIMATED';
      let reason: string | null;
      let priceId: string | null = null;

      if (ev.costClass === 'LOCAL_COMPUTE') {
        const price = await this.priceFor(ev.modelConfigId ?? 'local-compute', ev.createdAt);
        const rate = price?.unit === 'CPU_HOUR' ? price : null;
        const seconds = new Decimal(ev.computeSeconds?.toString() ?? '0');
        amount = rate ? seconds.mul(rate.inputPerMTok.toString()).div(3600).toDecimalPlaces(8, Decimal.ROUND_HALF_UP) : new Decimal(0);
        tier = rate ? 'FINALIZED' : 'FINAL_ESTIMATED';
        reason = rate ? null : 'PRICE_MISSING';
        priceId = rate?.id ?? null;
      } else {
        const price = await this.priceFor(ev.modelConfigId, ev.createdAt);
        const priced = priceUsage(
          price
            ? {
                inputPerMTok: price.inputPerMTok.toString(),
                outputPerMTok: price.outputPerMTok.toString(),
                cachedInputPerMTok: price.cachedInputPerMTok?.toString() ?? null,
                reasoningPerMTok: price.reasoningPerMTok?.toString() ?? null,
                batchDiscount: price.batchDiscount?.toString() ?? null,
              }
            : null,
          { input: ev.inputTokens, output: ev.outputTokens, cachedInput: ev.cachedInputTokens, reasoning: ev.reasoningTokens },
          ev.reported,
        );
        amount = priced.amount;
        tier = priced.status;
        reason = priced.reason;
        priceId = price?.id ?? null;
      }

      await tx.costEntry.create({
        data: {
          id: newId(),
          workspaceId: ev.workspaceId,
          userId: ev.userId ?? run?.userId ?? null,
          runId: ev.runId,
          usageEventId: ev.id,
          modelCallId: ev.modelCallId,
          modelConfigId: ev.modelConfigId,
          entryType: 'FINAL',
          tier,
          costClass: ev.costClass,
          amount: amount.toFixed(8),
          priceId,
          reason,
          feature: ev.feature ?? run?.graph ?? null,
          isDemo: ev.isDemo,
        },
      });

      if (ev.costClass === 'AI_API') {
        const alerts = await this.budgets.addSpend(
          ev.workspaceId,
          amount,
          { runId: ev.runId, userId: ev.userId ?? run?.userId },
          tx,
        );
        pendingAlerts.push(...alerts);
      }

      await tx.usageEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });

      const metrics = {
        labels: { tier, cost_class: ev.costClass, is_demo: String(ev.isDemo) },
        amount: amount.toNumber(),
      };

      return { outcome: 'created' as const, metrics };
    });

    if (result.metrics) {
      fvMetrics().ledgerEntries.add(1, result.metrics.labels);
      fvMetrics().ledgerChargedUsd.add(result.metrics.amount, result.metrics.labels);
    }
    if (pendingAlerts.length > 0) {
      await this.budgets.deliverAlerts(pendingAlerts).catch((err) => {
        this.log.error(`Failed to deliver budget alerts: ${err.message}`);
      });
    }

    return result.outcome;
  }

  /** Processes any usage events left behind (e.g. worker crash between write and enqueue). */
  async sweep(limit = 200) {
    const pending = await this.prisma.usageEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: 'asc' }, take: limit });
    let n = 0;
    for (const p of pending) {
      try {
        if ((await this.processUsageEvent(p.id)) === 'created') n++;
      } catch (e) {
        this.log.error(`usage ${p.id} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }

  /** Run total = AI API FINAL entries plus reconciliation adjustments; local compute is reported beside it. */
  async runTotals(runId: string) {
    const [entries, run, calls] = await Promise.all([
      this.prisma.costEntry.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.aiRun.findUnique({ where: { id: runId }, select: { status: true } }),
      this.prisma.modelCall.findMany({ where: { runId }, select: { status: true } }),
    ]);
    const settled = entries.filter((e) => SETTLED.has(e.entryType));
    const api = settled.filter((e) => e.costClass === 'AI_API');
    const local = settled.filter((e) => e.costClass === 'LOCAL_COMPUTE');
    const sum = (xs: typeof entries) => xs.reduce((acc, e) => acc.plus(e.amount.toString()), new Decimal(0));
    const estimate = entries.find((e) => e.entryType === 'ESTIMATE');

    const hasFailedCall = calls.some((c) => c.status !== 'OK');
    const interruptedWithoutUsage =
      !!run && ['INTERRUPTED', 'FAILED'].includes(run.status) && api.length === 0 && calls.length > 0;
    const unknownConsumption = hasFailedCall || interruptedWithoutUsage;

    return {
      total: sum(api).toFixed(8),
      estimate: estimate?.amount.toString() ?? null,
      tier: settledTier(api, !!estimate, unknownConsumption),
      localCompute: local.length ? { amount: sum(local).toFixed(8), tier: settledTier(local, false) } : null,
      isDemo: entries.some((e) => e.isDemo),
      entries,
      unknownConsumption,
    };
  }
}

/** Entry types that count toward spend (estimates never do). */
export const SETTLED = new Set(['FINAL', 'RECONCILIATION', 'VARIANCE']);

/** Cost state of a set of settled entries: reconciliation outranks finalization, a variance outranks both. */
export function settledTier(entries: { entryType: string; tier: string }[], hasEstimate: boolean, unknownConsumption = false): string {
  if (unknownConsumption) return 'FINAL_ESTIMATED';
  const finals = entries.filter((e) => e.entryType === 'FINAL');
  if (!finals.length) return hasEstimate ? 'PREFLIGHT_ESTIMATE' : 'FINALIZED';
  if (entries.some((e) => e.tier === 'VARIANCE')) return 'VARIANCE';
  const reconciled = entries.filter((e) => e.tier === 'RECONCILED').length;
  if (reconciled >= finals.length) return 'RECONCILED';
  if (finals.some((e) => e.tier === 'FINAL_ESTIMATED')) return 'FINAL_ESTIMATED';
  return 'FINALIZED';
}
