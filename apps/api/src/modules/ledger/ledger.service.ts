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
      const rate = await this.prisma.modelPrice.findFirst({
        where: { modelConfigId: 'local-compute' },
        orderBy: { effectiveFrom: 'desc' },
      });
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

    const reservation = ev.runId ? await this.prisma.budgetReservation.findFirst({ where: { runId: ev.runId } }) : null;
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
    await this.budgets.addSpend(ev.workspaceId, amount, reservation?.periodId);
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

  /** Run total = sum of FINAL entries (+ reconciliation adjustments). */
  async runTotals(runId: string) {
    const entries = await this.prisma.costEntry.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    const final = entries.filter((e) => e.entryType === 'FINAL' || e.entryType === 'RECONCILIATION');
    const total = final.reduce((acc, e) => acc.plus(e.amount.toString()), new Decimal(0));
    const estimate = entries.find((e) => e.entryType === 'ESTIMATE');
    let tier: string = estimate ? 'PREFLIGHT_ESTIMATE' : 'FINALIZED';
    if (final.length) {
      if (final.some((e) => e.tier === 'VARIANCE')) tier = 'VARIANCE';
      else if (final.every((e) => e.tier === 'RECONCILED')) tier = 'RECONCILED';
      else if (final.some((e) => e.tier === 'FINAL_ESTIMATED')) tier = 'FINAL_ESTIMATED';
      else tier = 'FINALIZED';
    }
    return {
      total: total.toFixed(8),
      estimate: estimate?.amount.toString() ?? null,
      tier,
      isDemo: entries.some((e) => e.isDemo),
      entries,
    };
  }
}
