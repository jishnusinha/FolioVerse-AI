import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { newId } from '../../common/ids';
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
   * Converts one usage event into a FINAL cost entry. Idempotent: the unique
   * (usage_event_id, entry_type) constraint makes reprocessing a no-op.
   */
  async processUsageEvent(usageEventId: string): Promise<'created' | 'duplicate' | 'missing'> {
    const ev = await this.prisma.usageEvent.findUnique({ where: { id: usageEventId } });
    if (!ev) return 'missing';
    const run = ev.runId ? await this.prisma.aiRun.findUnique({ where: { id: ev.runId } }) : null;

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

    try {
      await this.prisma.costEntry.create({
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.prisma.usageEvent.update({ where: { id: ev.id }, data: { processedAt: ev.processedAt ?? new Date() } });
        return 'duplicate';
      }
      throw e;
    }
    // Budgets cap AI API spend; local compute is an estimate reported separately.
    if (ev.costClass === 'AI_API') await this.budgets.addSpend(ev.workspaceId, amount, { runId: ev.runId, userId: ev.userId ?? run?.userId });
    await this.prisma.usageEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
    return 'created';
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
    const entries = await this.prisma.costEntry.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    const settled = entries.filter((e) => SETTLED.has(e.entryType));
    const api = settled.filter((e) => e.costClass === 'AI_API');
    const local = settled.filter((e) => e.costClass === 'LOCAL_COMPUTE');
    const sum = (xs: typeof entries) => xs.reduce((acc, e) => acc.plus(e.amount.toString()), new Decimal(0));
    const estimate = entries.find((e) => e.entryType === 'ESTIMATE');
    return {
      total: sum(api).toFixed(8),
      estimate: estimate?.amount.toString() ?? null,
      tier: settledTier(api, !!estimate),
      localCompute: local.length ? { amount: sum(local).toFixed(8), tier: settledTier(local, false) } : null,
      isDemo: entries.some((e) => e.isDemo),
      entries,
    };
  }
}

/** Entry types that count toward spend (estimates never do). */
export const SETTLED = new Set(['FINAL', 'RECONCILIATION', 'VARIANCE']);

/** Cost state of a set of settled entries: reconciliation outranks finalization, a variance outranks both. */
export function settledTier(entries: { entryType: string; tier: string }[], hasEstimate: boolean): string {
  const finals = entries.filter((e) => e.entryType === 'FINAL');
  if (!finals.length) return hasEstimate ? 'PREFLIGHT_ESTIMATE' : 'FINALIZED';
  if (entries.some((e) => e.tier === 'VARIANCE')) return 'VARIANCE';
  const reconciled = entries.filter((e) => e.tier === 'RECONCILED').length;
  if (reconciled >= finals.length) return 'RECONCILED';
  if (finals.some((e) => e.tier === 'FINAL_ESTIMATED')) return 'FINAL_ESTIMATED';
  return 'FINALIZED';
}
